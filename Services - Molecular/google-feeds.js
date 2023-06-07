const AbstractWorkerClass = require("./abstract");
const { shopProductCatalogs, shopJobStats, shopJobStatsHistory, shopInventories, storesPdpInfo } = require("../../core/sql/controller");
const async = require("async");
const moment = require("moment");
const momentTz = require("moment-timezone");
const CONSTANTS = require("../../constants");
const { shopProductCatalogs: { SCHEMA: { FIELDS: SHOP_PRODUCT_CATALOGS_FIELDS } } } = require("../../core/sql/model");
const { gPlatformAccess: { SCHEMA: { FIELDS: G_PLATFORM_ACCESS_FIELDS } } } = require("../../core/sql/model");
const { shopProductCategory: { SCHEMA: { FIELDS: SHOP_PRODUCT_CATEGORIES_FIELDS } } } = require("../../core/sql/model");
const { locallyStores: { SCHEMA: { FIELDS: LOCALLY_STORES_FIELDS } } } = require("../../core/sql/model");
const { shopInventories: { SCHEMA: { FIELDS: SHOP_INVENTORIES_FIELDS } } } = require("../../core/sql/model");
const { shopRetailerSettings: { SCHEMA: { FIELDS: SHOP_RETAILER_SETTINGS_FIELDS } } } = require("../../core/sql/model");
const { countryCodes: { SCHEMA: { FIELDS: COUNTRY_CODES_FIELDS } } } = require("../../core/sql/model");
const { googleTaxonomy: { SCHEMA: { FIELDS: GOOGLE_TAXONOMY_FIELDS } } } = require("../../core/sql/model");
const fileHelper = require("../../helpers/fileHelper");
const s3FileHelper = require("../../helpers/s3FileHelper");
const redisGoogleSurface = require("../../core/redis/googleSurface");
const redisGoogleAds = require("../../core/redis/googleAds");
const redisSearchEngineList = require("../../core/redis/searchEngineList");
const searchStats = require("./searchStats");
const redisLocationUPC = require("../../core/redis/locationUPC");
const miscHelper = require("../../helpers/miscHelper");
const stringHelper = require("../../helpers/stringHelper");

let LOGGER = (method) => {
  return `[${moment().format('YYYY-MM-DD HH:mm:ss')}] GOOGLE-ADS-MESSAGE-PROCESSING | ${method} |`;
};

class GoogleAcrossSurface extends AbstractWorkerClass {
  constructor(workerId, queueUrl, SQS) {
    super({
      queueUrl, workerId,
      handleMessage: async (message) => {
        return new Promise((resolve, reject) => {
          _handleMessage(message, this.workerId, (error, result) => {
            if (error) {
              return reject(error)
            }
            return resolve(result);
          });
        })
      }, SQS
    });
  }

  start(message) {
    super.start(message);
  }
}

module.exports = GoogleAcrossSurface;


const _handleMessage = (message, workerId, callback) => {
  let data = JSON.parse(message.Body);
  console.log(LOGGER("EXECUTING GOOGLE ACROSS SURFACE MESSAGE: "), `WORKER ID: ${workerId}`, message.MessageId, "\n", JSON.stringify(data, null, 2));

  if (!data.meta && !data.meta.retailerId) return callback();
  const retailerId = data.meta.retailerId;

  redisGoogleSurface.getMessageBody(retailerId, (error, _data) => {
    if (!_data) {
      console.error(LOGGER('Error getting data from Redis'), error);
      return callback();
    }
    _data.retailerId = retailerId;
    data = _data;
    const allLocations = data.allLocations;
    const batchNumber = data.batchNumber;
    async.series({
      STORES_PDP_INFO: cb => storesPdpInfo.fetchLocationsData(allLocations, (error, result) => {
        data.storeLocationMap = new Map();
        data.storeNameMap = new Map();
        result.forEach(_obj => {
          data.storeLocationMap.set(_obj[LOCALLY_STORES_FIELDS.STORE_LOCATION_ID], _obj);
          data.storeNameMap.set(_obj['store_name'], _obj);
          data.isLocally = !!_obj[LOCALLY_STORES_FIELDS.LOCALLY_STORE_ID];
        });
        data.newNaming = result.length > 1 && data.storeNameMap.size > 1;
        cb();
      }),
      PRODUCT_FEEDS: cb => _handleProductFeeds(data, () => cb()),
      LOCAL_PRODUCT_FEEDS: cb => _handleLocalProductFeeds(data, () => cb())
    }, () => {
      let scripts = [];
      allLocations.forEach(_loc => {
        scripts.push(cb => redisSearchEngineList.addInList(batchNumber, retailerId, _loc, () => cb()))
      })

      async.parallelLimit(scripts, 10, () => {
        redisGoogleSurface.deleteKey(retailerId, () => {
          _handleStats(data.batchNumber, allLocations, () => {
            console.log(LOGGER("JOB FINISHED FOR: "), JSON.stringify(data.meta, null, 2));
            return callback()
          });
        });
      });
    })
  })
}

const _handleLocalProductFeeds = (data, callback) => {
  async.series({
    UPC_DETAIL: cb => _upcDetailLocalProductFeeds(data, (error, map) => {
      cb();
    }),
    FORMAT_DATA_AND_UPLOAD: cb => _formatDataLocalProductFeeds(data, cb)
  }, () => callback());
}

const _upcDetailLocalProductFeeds = (data, callback) => {
  if (!data || !data.list || !data.list.length) {
    console.warn(LOGGER('_formatDataLocalProductFeeds'), "No list found");
    return callback();
  }

  let scripts = [];

  const retailerId = data.retailerId;

  data.list.forEach(obj => {
    scripts.push(cb => {
      let _location = obj.locationId;

      let locallyStoreId, locallyStoreName;
      if (data.storeLocationMap.get(_location)) {
        locallyStoreId = data.storeLocationMap.get(_location)[LOCALLY_STORES_FIELDS.LOCALLY_STORE_ID];
        locallyStoreName = data.storeLocationMap.get(_location)[LOCALLY_STORES_FIELDS.STORE_NAME];
      }

      if (obj.gGMBStoreId) {
        let _UPCs = [...new Set(obj.UPCs)];
        shopInventories.upcDetailGoogleLocalProductFeeds(_location, _UPCs, (error, result = []) => {
          result.length && result.forEach(_obj => {
            let availability = 'limited availability';
            if (_obj[SHOP_INVENTORIES_FIELDS.QUANTITY_ON_HAND] == 0 || data[SHOP_RETAILER_SETTINGS_FIELDS.MUTED_FLAG] === 1) {
              availability = 'out of stock';
            } else if (_obj[SHOP_INVENTORIES_FIELDS.QUANTITY_ON_HAND] > 2) {
              availability = 'in stock';
            }
            if (_checkIfImageValid(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_IMAGE_URL])) {
              const _detail = {
                "target_customer_id": _obj[G_PLATFORM_ACCESS_FIELDS.G_MERCHANT_ID],
                "store_code": _obj[SHOP_RETAILER_SETTINGS_FIELDS.G_GMB_STORE_ID],
                "id": _obj[SHOP_INVENTORIES_FIELDS.UPC],
                // "gtin": _obj[SHOP_INVENTORIES_FIELDS.UPC].startsWith('9999') ? undefined : _obj[SHOP_INVENTORIES_FIELDS.UPC],
                "gtin": _getGTIN(_obj),
                "quantity": _obj[SHOP_INVENTORIES_FIELDS.QUANTITY_ON_HAND],
                // "price": (Number(_obj[SHOP_INVENTORIES_FIELDS.MSRP])).toFixed(2) + " " + _obj[COUNTRY_CODES_FIELDS.CURRECY_CODE],
                "price": _getPrice(_obj, _obj[COUNTRY_CODES_FIELDS.CURRECY_CODE], data[SHOP_RETAILER_SETTINGS_FIELDS.LOCALLY_STORE_PRICE_CHOICE]),
                //"sale_price": (Number(_obj[SHOP_INVENTORIES_FIELDS.SALES_PRICE])).toFixed(2) + " " + _obj[COUNTRY_CODES_FIELDS.CURRECY_CODE],
                //"sale_price": _getSalesPrice(_obj, _obj[COUNTRY_CODES_FIELDS.CURRECY_CODE]),
                // 4/2/23 Tim Nero, temporarily not submitting sales price to Google
                "sale_price": "",
                // "Sale price effective date": moment().format("YYYY-MM-DD"),
                "availability": availability,
                "timestamp": momentTz.tz(_obj[SHOP_INVENTORIES_FIELDS.FILE_DATE], "America/New_York").format(),
                "pickup_method": "buy",
                "pickup_sla": "same day",
                // "link_template": data.isLocally ? _getLinkTemplate(_obj, retailerId, locallyStoreId, locallyStoreName) : ""
              };
              obj.UPCDetail[_obj[SHOP_INVENTORIES_FIELDS.UPC]] = _detail;
            }
          })
          cb();
        })
      } else {
        cb();
      }
    })
  })

  async.parallelLimit(scripts, 10, () => {
    return callback();
  })
}

const _formatDataLocalProductFeeds = (data, callback) => {

  const _byStoreName = {};
  if (!data || !data.list || !data.list.length) {
    console.warn(LOGGER('_formatDataLocalProductFeeds'), "No list found");
    return callback();
  }

  data.list.forEach(obj => {
    const storeName = data.newNaming ? data.storeLocationMap.get(obj.locationId) ? data.storeLocationMap.get(obj.locationId)['store_name'] : 'any' : 'any';
    _byStoreName[storeName] = [...(_byStoreName[storeName] || []), ...(obj.UPCDetail && Object.values(obj.UPCDetail) || [])];
  });
  Object.keys(_byStoreName).forEach(store => {
    const _loc = data.newNaming && data.storeNameMap.get(store) ? data.storeNameMap.get(store)[LOCALLY_STORES_FIELDS.STORE_LOCATION_ID] : '';
    let fileNameLocalProductFeeds = `${data.retailerName.replace(/ /g, "_")}_${data.retailerId}${_loc ? `_${_loc}` : ''}_Google-LocalProductFeed.CSV`;
    fileNameLocalProductFeeds = fileNameLocalProductFeeds.replace(/\//g, '-');
    if (_byStoreName[store]?.length) {
      fileHelper.jsonToCsv(_byStoreName[store], fileNameLocalProductFeeds).then(() => {
        _uploadToS3(fileNameLocalProductFeeds, data.systemSettings, () => {
          _deleteFile(fileNameLocalProductFeeds, () => { });
        });
      });
    }
  });
  callback();
};

const _handleProductFeeds = (data, callback) => {
  let upcDetailMap = new Map();
  async.series({
    UPC_DETAIL: cb => _upcDetailProductFeeds(data, (error, map) => {
      upcDetailMap = map;
      if (!upcDetailMap.size) {
        console.warn(LOGGER('_handleProductFeeds'), "No _upcDetailProductFeeds found");
        return callback();
      }
      data.upcDetailMap = upcDetailMap;
      cb();
    }),
    FORMAT_DATA_AND_UPLOAD: cb => _formatDataProductFeeds(data, cb)
  }, () => callback());
}

const _upcDetailProductFeeds = (data, callback) => {
  let upcDetailMap = new Map();
  let upcSISource = new Map();
  let _return = new Map();

  let _allUniqueUPC = [];
  _allUniqueUPC = (data && data.list && data.list.map(obj => obj.UPCs)) || [];
  _allUniqueUPC = [...new Set(_allUniqueUPC)];

  let _locationIds = [... new Set((data && data.list && data.list.map(obj => obj.locationId)))];

  let scripts = [];

  data.list.forEach(obj => {
    const _loc = obj.locationId;
    scripts.push(cb => redisLocationUPC.addInList(data.batchNumber, _loc, obj.UPCs, () => cb()));
  });

  async.parallelLimit(scripts, 10, () => {
    const upcScripts = [];
    _locationIds.forEach(location => {
      upcScripts.push(cb => {
        shopProductCatalogs.upcDetailForGoogleSurface(_allUniqueUPC, [location], (error, result = []) => {
          result && result.map(_upcDetail => {
            if (_upcDetail) {
              const storeName = data.storeLocationMap.get(_upcDetail[LOCALLY_STORES_FIELDS.STORE_LOCATION_ID])['store_name'];
              upcSISource.set(`${_upcDetail[SHOP_PRODUCT_CATALOGS_FIELDS.UPC]}:${storeName}`, _upcDetail['SI_SOURCE']);
              upcDetailMap.set(`${_upcDetail[SHOP_PRODUCT_CATALOGS_FIELDS.UPC]}:${storeName}:${_upcDetail['PL_SOURCE']}`, _upcDetail);
            }
          });
          cb();
        });
      });
    });

    async.parallelLimit(upcScripts, 10, () => {
      const __upcs = ([...upcDetailMap.keys()]) || [];
      __upcs.forEach(_key => {
        let [_upc, storeName, _plSource] = _key.split(':');
        let _catalogToUse;
        const _inventorySource = upcSISource.get(`${_upc}:${storeName}`);


        if (data.isLocally) {
          _catalogToUse = upcDetailMap.get(`${_upc}:${storeName}:Locally`);
        } else {
          _catalogToUse = upcDetailMap.get(`${_upc}:${storeName}:${_inventorySource}`);
        }
        _catalogToUse && _return.set(_key, _catalogToUse);
      })
      callback(null, _return);
    })
  });
};

const _formatDataProductFeeds = (data, callback) => {
  const { upcDetailMap, list, retailerId, systemSettings, currencyCode, retailerName, storeNameMap, storeLocationMap, newNaming } = data;

  let _allData = ([...upcDetailMap.values()]);
  const groupItemIdMap = new Map();
  const _byStoreName = {};
  _allData.forEach(_obj => {
    const productTitle = _getProductTitle(_obj);
    if (productTitle) {
      const shareUrl = _getShareUrl(_obj, retailerId);

      let groupItemId = groupItemIdMap.get(productTitle);

      !groupItemId && (groupItemId = miscHelper.getRandomNumber()) && groupItemIdMap.set(productTitle, groupItemId);
      if (shareUrl && _checkIfImageValid(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_IMAGE_URL])) {
        const storeName = newNaming ? storeLocationMap.get(_obj[LOCALLY_STORES_FIELDS.STORE_LOCATION_ID])['store_name'] || 'any' : 'any';
        let availability = 'limited availability';
        if (_obj[SHOP_INVENTORIES_FIELDS.QUANTITY_ON_HAND] == 0 || data[SHOP_RETAILER_SETTINGS_FIELDS.MUTED_FLAG] === 1) {
          availability = 'out of stock';
        } else if (_obj[SHOP_INVENTORIES_FIELDS.QUANTITY_ON_HAND] > 2) {
          availability = 'in stock';
        }
        _byStoreName[storeName] = [
          ...(_byStoreName[storeName] || []),
          {
            Id: _obj[SHOP_PRODUCT_CATALOGS_FIELDS.UPC],
            Custom_label_0: _obj[SHOP_PRODUCT_CATALOGS_FIELDS.SEASON_NAME],
            brand: _obj[SHOP_PRODUCT_CATALOGS_FIELDS.LOCALLY_BRAND_NAME] && _obj[SHOP_PRODUCT_CATALOGS_FIELDS.LOCALLY_BRAND_NAME].substr(0, 70),
            title: productTitle,
            color: _obj[SHOP_PRODUCT_CATALOGS_FIELDS.COLOR_NAME],
            gender: _getGender(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.GENDER], _obj[SHOP_PRODUCT_CATEGORIES_FIELDS.GOOGLE_PATH_NAME]),
            size: _getSize(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.SIZE_1]),
            item_group_id: groupItemId,
            age_group: _getAgeGroup(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.GENDER]),
            description: _getDescription(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_DESCRIPTION], _obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME], _obj[SHOP_PRODUCT_CATALOGS_FIELDS.LOCALLY_BRAND_NAME], _obj[SHOP_PRODUCT_CATALOGS_FIELDS.SEASON_NAME], productTitle).substr(0, 5000),
            // price: (Number(_obj[SHOP_INVENTORIES_FIELDS.MSRP])).toFixed(2) + " " + currencyCode,
            price: _getPrice(_obj, currencyCode, data[SHOP_RETAILER_SETTINGS_FIELDS.LOCALLY_STORE_PRICE_CHOICE]),
            //3/28/23 Tim Nero removed sales price from output file list
            //sale_price: (Number(_obj[SHOP_INVENTORIES_FIELDS.SALES_PRICE])).toFixed(2) + " " + currencyCode,
            availability: availability,
            custom_label_1: _obj['PC-' + SHOP_PRODUCT_CATEGORIES_FIELDS.PRODUCT_CATEGORY_NAME] || _obj['PL-' + SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_CATEGORY_PATH],
            // gtin: _obj[SHOP_INVENTORIES_FIELDS.UPC].startsWith('9999') ? undefined : _obj[SHOP_INVENTORIES_FIELDS.UPC],
            gtin: _getGTIN(_obj),
            Google_product_category: ['Fitted', 'Shopify', 'BigCommerce'].includes(_obj['PL_SOURCE']) ? _obj[GOOGLE_TAXONOMY_FIELDS.GOOGLE_TAXONOMY_PATH] : _obj[SHOP_PRODUCT_CATEGORIES_FIELDS.GOOGLE_PATH_NAME],
            Link: shareUrl,
            image_link: _obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_IMAGE_URL],
            Condition: 'new',
            identifier_exists: _obj[SHOP_PRODUCT_CATALOGS_FIELDS.UPC].startsWith('9999') ? 'no' : (_obj[SHOP_PRODUCT_CATALOGS_FIELDS.UPC] ? 'yes' : 'no'),
            link_template: data.isLocally ? shareUrl + '&store={store_code}&utm_source=BrandSlice&campaign_source=Google' : '',
          }];
      }
    }
  });
  Object.keys(_byStoreName).forEach(store => {
    const _loc = newNaming && storeNameMap.get(store) ? storeNameMap.get(store)[LOCALLY_STORES_FIELDS.STORE_LOCATION_ID] : '';
    let fileNameProductFeeds = `${retailerName.replace(/ /g, "_")}_${retailerId}${_loc ? `_${_loc}` : ''}_Google-ProductFeed.CSV`;
    fileNameProductFeeds = fileNameProductFeeds.replace(/\//g, '-');
    if (_byStoreName[store]?.length) {
      fileHelper.jsonToCsv(_byStoreName[store], fileNameProductFeeds).then(() => {
        _uploadToS3(fileNameProductFeeds, systemSettings, () => {
          _deleteFile(fileNameProductFeeds, () => { });
        });
      });
    }
  });
  callback();
};

const _getProductTitle = (_obj) => {
  let title = '';
  try {
    let regex = new RegExp(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.LOCALLY_BRAND_NAME], 'ig')
    if ((_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME].match(regex) || []).length > 0) {
      title = _obj[SHOP_PRODUCT_CATALOGS_FIELDS.GENDER] ? `${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.GENDER]} ${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME]}` : `${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME]}`;
    } else {
      title = _obj[SHOP_PRODUCT_CATALOGS_FIELDS.GENDER] ? `${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.LOCALLY_BRAND_NAME]} ${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.GENDER]} ${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME]}` : `${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.LOCALLY_BRAND_NAME]} ${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME]}`;
    }
    if (_obj[SHOP_PRODUCT_CATALOGS_FIELDS.COLOR_NAME]) {
      regex = new RegExp(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.COLOR_NAME], 'ig')
      if ((_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME].match(regex) || []).length > 0) {
      } else {
        title = `${title} ${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.COLOR_NAME]}`;
      }
    }
    if (_obj[SHOP_PRODUCT_CATALOGS_FIELDS.SIZE_1]) {
      regex = new RegExp(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.SIZE_1], 'ig')
      if ((_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME].match(regex) || []).length > 0) {
        //do nothing. size_1 is already there in the title
      } else {
        title = `${title} ${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.SIZE_1]}`;
      }
    }
    return title.substr(0, 150);
  } catch (e) {
    console.log(LOGGER(`ERROR building product title`), e);
    return title;
  }
}

const _getGender = (gender, googlePathName) => {
  switch (gender) {
    case 'Mens':
    case 'mens':
    case 'Boys':
    case 'boys':
      return 'male';

    case 'Womens':
    case 'womens':
    case 'Girls':
    case 'girls':
      return 'female';

    default: {
      if (googlePathName && googlePathName.startsWith("Apparel & Accessories")) {
        return "Unisex";
      } else {
        return "";
      }
    };
  }
}

const _getGTIN = (_obj) => {
  switch (_obj[SHOP_PRODUCT_CATALOGS_FIELDS.LOCALLY_BRAND_NAME]) {
    case "On Running":
    case "on running":
    case "Salewa":
    case "salewa":
    case "Helinox":
    case "helinox":
    case "Sea To Summit":
    case "sea to summit":
    case "Petzl":
    case "petzl":
    case "Leki":
    case "leki":
    case "Deuter":
    case "deuter":
    case "Fjallraven":
    case "fjallraven":
    case "Exped":
    case "exped":
    case "Garmont":
    case "garmont":
    case "Red Paddle Co":
    case "red paddle co":
    case "Os1st":
    case "os1st":
    case "Cep Compression":
    case "cep compression":
    case "Snow Peak":
    case "snow peak":
    case "Haba":
    case "haba":
    case "Peg Perego Brand":
    case "peg perego brand":
    case "Agio":
    case "agio":
      return ""
    default: return _obj[SHOP_INVENTORIES_FIELDS.UPC].startsWith('9999') ? undefined : _obj[SHOP_INVENTORIES_FIELDS.UPC]
  }
}

const _getPrice = (_obj, currencyCode, priceChoice) => {
  if (priceChoice === 1) {
    return (Number(_obj[SHOP_INVENTORIES_FIELDS.MSRP])).toFixed(2) + " " + currencyCode;
  } else if (Number(_obj[SHOP_INVENTORIES_FIELDS.SALES_PRICE]) < Number(_obj[SHOP_INVENTORIES_FIELDS.MSRP])) {
    return (Number(_obj[SHOP_INVENTORIES_FIELDS.SALES_PRICE])).toFixed(2) + " " + currencyCode;
  } else {
    return (Number(_obj[SHOP_INVENTORIES_FIELDS.MSRP])).toFixed(2) + " " + currencyCode;
  }
}

const _getSalesPrice = (_obj, currencyCode) => {
  if ((Number(_obj[SHOP_INVENTORIES_FIELDS.SALES_PRICE])) == (Number(_obj[SHOP_INVENTORIES_FIELDS.MSRP]))) {
    return '';
  }
  return (Number(_obj[SHOP_INVENTORIES_FIELDS.SALES_PRICE])).toFixed(2) + " " + currencyCode;
}



const _getSize = (size) => {
  switch (size) {
    case 'OS':
    case 'One size':
    case 'One':
    case 'O/S':
    case 'OSFA':
    case 'OSFM':
    case 'OSZ':
    case 'ONE SIZE FITS MOST':
      return 'OSFA';
    default: return size;
  }
}

const _getAgeGroup = (gender) => {
  if (typeof gender !== 'string') gender = "";
  if (gender.toLowerCase().includes('man') || gender.toLowerCase().includes('men') || gender.toLowerCase().includes('mens') || gender.toLowerCase().includes('woman') || gender.toLowerCase().includes('women') || gender.toLowerCase().includes('womens')) {
    return 'adult'
  } else if (gender.toLowerCase().includes('kids little') || gender.toLowerCase().includes('kids toddler')) {
    return 'toddler'
  } else if (gender.toLowerCase().includes('kid') || gender.toLowerCase().includes('boys') || gender.toLowerCase().includes('girls') || gender.toLowerCase().includes('junior') || gender.toLowerCase().includes('juniors') || gender.toLowerCase().includes('kids')) {
    return 'kids'
  } else if (gender.toLowerCase().includes('infant')) {
    return 'infant'
  } else {
    return "adult";
  }
}

const _uploadToS3 = (fileName, systemSettings, callback) => {
  s3FileHelper.upload(systemSettings, fileName, `Shopping_Channel_Feeds/${fileName}`, callback)
}

const _deleteFile = (fileName, callback) => {
  fileHelper.singleDelete(fileName, callback);
}

const _getDescription = (description, productName, brandName, season, productTitle) => {
  if (description) return description;

  if (productName && brandName && season) return `${productName} From ${brandName} ${season} Catalog`;

  return productTitle;

}

const _handleStats = (batchNumber, allLocations, callback) => {
  let scripts = [];

  allLocations.forEach(_loc => {
    scripts.push(cb => redisGoogleSurface.retailerShopExecuted(batchNumber, _loc, () => cb()))
  })
  async.parallelLimit(scripts, 10, () => {
    redisGoogleSurface.currentSQSExecuted(batchNumber, () => {
      redisGoogleAds.engineFinished(batchNumber, (error, result) => {
        if (result && result.engineFinished) {
          shopJobStatsHistory.updateEndTime(batchNumber, () => { });
          searchStats.insertEntriesInRetailerStats(batchNumber, result.result, () => { })
        }
        callback();
      })
    });
  })
}

const Url = require('url-parse');

const _checkIfImageValid = (imageURL) => {
  if (!imageURL) return false;
  const parse = Url(imageURL, true);
  return CONSTANTS.ADS.FEEDS.ALLOWED_IMAGE_EXTENSIONS.some((extension) => {
    return parse.pathname.toLowerCase().endsWith(`${extension}`);
  });
}

const _getShareUrl = (_obj, retailerId) => {
  switch (_obj['PL_SOURCE']) {
    case 'Lightspeed':
    case 'Fitted':
    case 'BigCommerce':
    case 'Shopify': {
      return `${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_URL]}?utm_source=${retailerId}&utm_medium=Google-Shopping`;
    }
    case 'Locally': {
      let _locallyNumber = _obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_URL] && _obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_URL].split("/");
      _locallyNumber && _locallyNumber.length && (_locallyNumber = _locallyNumber[_locallyNumber.length - 2]);
      return `https://${_obj[LOCALLY_STORES_FIELDS.STORE_NAME]}/product/${_locallyNumber}/${stringHelper.modifyForShareURL(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.LOCALLY_BRAND_NAME])}-${stringHelper.modifyForShareURL(_obj[SHOP_PRODUCT_CATALOGS_FIELDS.PRODUCT_NAME])}?upc=${_obj[SHOP_PRODUCT_CATALOGS_FIELDS.UPC]}`;
    }
    default: return;
  }
}