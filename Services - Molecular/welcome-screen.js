const {systemSettingsCache, gPlatformAccess, retailerLocations, addresses, retailerAccounts, industries, brandAccounts, brandAuthorizedRetailers, shopFbImages} = require("../../core/sql/controller");
const {base} = require("../../core/sql/wrapper");
const node_async = require("async");
const fetch = require('node-fetch');
const {platformAccesses} = require("../../core/sql/controller");
const {platformAccesses: {SCHEMA: {FIELDS: PLATFORM_ACCESSES_FIELDS, TABLE_NAME: PLATFORM_ACCESSES_TABLE_NAME, PLATFORM_TYPES:PLATFORM_TYPES, ENTITY_ACCESS_TYPES:ENTITY_ACCESS_TYPES}}} = require("../../core/sql/model");
const storesPdfInfo = require("../../core/sql/controller/storesPdpInfo");
const {locallyStores: {SCHEMA: {FIELDS: STORES_PDP_INFO_FIELDS, TABLE_NAME: STORES_PDP_INFO_TABLE_NAME}}} = require("../../core/sql/model");
const {gPlatformAccess: {SCHEMA: {FIELDS: G_PLATFORM_ACCESSES_FIELDS, TABLE_NAME: G_PLATFORM_ACCESSES_TABLE_NAME}}} = require("../../core/sql/model");
const {retailerLocations: {SCHEMA: {FIELDS: RETAILER_LOCATIONS_FIELDS, TABLE_NAME: RETAILER_LOCATIONS_TABLE_NAME}}} = require("../../core/sql/model");
const { retailerAccounts: {SCHEMA: {FIELDS: RETAILER_ACCOUNTS_FIELDS, TABLE_NAME: RETAILER_ACCOUNTS_TABLE_NAME, WELCOME_SCRREN_FLAGS: WELCOME_SCRREN_FLAGS_NAMES}}} = require("../../core/sql/model");
const {addresses: {SCHEMA: {FIELDS: ADDRESSES_FIELDS, TABLE_NAME: ADDRESSES_TABLE_NAME}}} = require("../../core/sql/model");
const {brandAuthorizedRetailers: {SCHEMA: {TABLE_NAME: BAR_TABLE, FIELDS: BAR_FIELDS}}} = require("../../core/sql/model");
const {shopFbImages: {SCHEMA: {FIELDS: SHOP_FB_IMAGES_FIELDS, TABLE_NAME: SHOP_FB_IMAGES_TABLE_NAME}}} = require("../../core/sql/model");
const email = require("../../publish-engine/workers/email");
const axios = require('axios');
const sharp = require('sharp');
const AWS = require('aws-sdk');
const {systemSettings: {FIELDS}} = require("../../core/sql/model");
/**
 * @Author : Pardeep
 * @Purpose : For validating whether inventory data source is already updated or not.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const getRetailerAccountDetails = async (req, callback) => {
  const { retailerId } = req.params;
  let retailerDetails
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  node_async.series({
    GET_RETAILER_ACCOUNT_DETAILS: cb => {
      let fields = `${RETAILER_ACCOUNTS_FIELDS.INDUSTRY_REC_ID}, ${RETAILER_ACCOUNTS_FIELDS.RETAILER_NAME}`      
      retailerAccounts.getAccountDetails(fields, retailerId,(error, data) => {
        retailerDetails = data
        cb();
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: retailerDetails}));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : For validating whether inventory data source is already updated or not.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const localAdvertisingStepOneVerification = async (req, callback) => {
  const { retailerId } = req.params;
  let storesPdfInfoData
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  node_async.series({
    VALIDATE_STORE_PDP_DATA: cb => {
      storesPdfInfo.localAdvertisingStepOneVerification(retailerId,(error, data) => {
        storesPdfInfoData = data
        cb();
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: storesPdfInfoData}));
  })
}

/**
 * @Author : Pardeep 
 * @Purpose : For saving inventory data source into Db table
 * @Sources: 'Locally', 'BigCommerce', 'Shopify', 'Lightspeed', 'Fitted Retail.
 * @param {*} req 
 * @param {*} callback 
 */
 const saveInventoryDataScource = async (req, callback) => {
  const { retailerId, inventoryDataSource } = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  if (!inventoryDataSource) return callback(base.error({ error: true, message: "Missing attribute: Invnetory Data Source" }), null);
  let dataSources = ['Locally', 'BigCommerce', 'Shopify', 'Lightspeed', 'Fitted Retail']
  let existingStoresPdfInfoData
  if (!dataSources.includes(inventoryDataSource)) {
    return callback(base.error({ error: true, message: "Warning! Invalid invnetory data source." }), null);
  }
  node_async.series({
    VALIDATE_STORE_PDP_DATA: cb => {
      storesPdfInfo.localAdvertisingStepOneVerification(retailerId,(error, data) => {
        existingStoresPdfInfoData = data
        cb();
      })
    },
    UPDATE_INVENTORY_DATA_SOURCE: cb => {
      let updateData = {
        set: {
         [STORES_PDP_INFO_FIELDS.STORE_NAME] : (inventoryDataSource == 'Locally') ? 'TEMP' : null,
         [STORES_PDP_INFO_FIELDS.BIGCOMM_STORE_NAME] : (inventoryDataSource == 'BigCommerce') ? 'TEMP' : null,
         [STORES_PDP_INFO_FIELDS.SHOPIFY_STORE_NAME] : (inventoryDataSource == 'Shopify') ? 'TEMP' : null,
         [STORES_PDP_INFO_FIELDS.LIGHTSPEED_STORE_NAME] : (inventoryDataSource == 'Lightspeed') ? 'TEMP' : null,
         [STORES_PDP_INFO_FIELDS.FITTED_IMPORT_URL] : (inventoryDataSource == 'Fitted Retail') ? 'TEMP' : null
        },
        whereCondition:{
          [STORES_PDP_INFO_FIELDS.RETAILER_REC_ID] : retailerId
        }
      }
      if(Object.keys(existingStoresPdfInfoData).length){
        storesPdfInfo.updateInventroyDataSource(updateData,(error, data) => {
          if(error) return callback(base.error({ error: true, message: "Oops, we ran into an issue while trying to save the inventory source you just selected. Try again OR contact support@brandslice.io or 703-783-6240" }), null);
          cb();
        })
      }else{
        let insertData = updateData.set;
        insertData[STORES_PDP_INFO_FIELDS.RETAILER_REC_ID] = retailerId
        storesPdfInfo.insertInventroyDataSource(insertData,(error, data) => {
          if(error) return callback(base.error({ error: true, message: "Oops, we ran into an issue while trying to save the inventory source you just selected. Try again OR contact support@brandslice.io or 703-783-6240" }), null);
          cb();
        })
      }
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: true }));
  })
}

/**
 * @Author : Pardeep 
 * @Purpose_1 : For generating and saving shopify access token
 * @Purpose_1 : If API is called from retailer settings, then it will not save token into DB. I will only send token in response body along with list of locations.
 * @param {*} req 
 * @param {*} callback 
 */
 const generateSaveShopifyOAuthToken = async (req, callback) => {
  if (!req.params?.code) return callback(base.error({ error: true, message: "Missing attribute(s): Retailer record ID is missing." }), null);
  if (!req.params?.shop) return callback(base.error({ error: true, message: "Missing attribute(s): Shop name is missing." }), null);
  if (!req.params?.redirectUri) return callback(base.error({ error: true, message: "Missing attribute(s): Redirect URI is missing." }), null);
  if (!req.params?.retailerId) return callback(base.error({ error: true, message: "Missing attribute(s): Retailer record ID is missing." }), null);
  let systemSettings, accessToken;
  let code = req.params.code;
  let shop = req.params.shop;
  let redirectUri = req.params.redirectUri;
  let entityRecId = req.params.retailerId
  let skipSave = req.params?.skipSave ? true : false;
  let responseData = {};
  node_async.series({
    SYSTEM_SETTINGS: cb => {
      systemSettingsCache((error, result) => {
        if(error) return callback(base.error({message: JSON.stringify(error)}), null);
        systemSettings = result;
        cb();
      })
    },
    GET_SHOPIFY_AUTH_TOKENS: cb =>{      
      let url = `https://${shop}.myshopify.com/admin/oauth/access_token`;
      let curlBody = JSON.stringify({
        "client_id": systemSettings['SHOPIFY:BRANDSLICE_CLIENT_ID'],
        "client_secret":systemSettings['SHOPIFY-BRANDSLICE_CLIENT_SECRET'],
        "code": code,
        "redirect_uri":redirectUri
      });
      let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: url,
        headers: { 
          'Content-Type': 'application/json', 
        },
        data : curlBody
      };
      axios.request(config).then((response) => {
        accessToken = response?.data?.access_token;
        responseData['accessToken'] = accessToken;
        cb();
      }).catch((error) => {
        return callback(base.error(), 'Error fetching tokens.');
      });
    },
    DELETE_EXISTING_GOOGLE_AUTH_TOKENS_FROM_DB: cb =>{
      if(!skipSave){
        platformAccesses.deletePlatformAccessEntry(entityRecId, ENTITY_ACCESS_TYPES.RETAILER, PLATFORM_TYPES.SHOPIFY, (error,result) => {
          cb();
        })
      }else cb();
    },
    SAVE_SHOPIFY_AUTH_TOKENS_INTO_DB: cb =>{
      if(!skipSave){
        let data = {
          [PLATFORM_ACCESSES_FIELDS.PLATFORM_TYPE]: PLATFORM_TYPES.SHOPIFY,
          [PLATFORM_ACCESSES_FIELDS.ENTITY_ACCESS_TYPE]: ENTITY_ACCESS_TYPES.RETAILER,
          [PLATFORM_ACCESSES_FIELDS.ENTITY_REC_ID]: entityRecId,
          [PLATFORM_ACCESSES_FIELDS.ACCESS_TOKEN]: accessToken,
          [PLATFORM_ACCESSES_FIELDS.ACCOUNT_ID]: shop,
          [PLATFORM_ACCESSES_FIELDS.ACCOUNT_MANAGED_BY]: 1
        };
        platformAccesses.createPlatformAccessEntry(data, () => cb())
      }else cb();
    },
    GET_RETAILER_LOCATIONS_FOR_SHOPIFY_MODAL: cb =>{
      if(skipSave){
        retailerLocations.retailerAllLocationsAndAddresses(req.params.retailerId, (error, data) => {
          responseData['locations'] = data;
          cb()
        })
      }else cb();
    },
  }, (error, result) => {
    if(error) {
      return callback(base.error(), null);
    }
    return callback(null, base.success({result: responseData}))
  })   
}

/**
 * @Author : Pardeep
 * @Purpose : For validating whether retailer's shopify OAuth has already performed or not.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const shopifyOAuthVerification = async (req, callback) => {
  const { retailerId } = req.params;
  let recordAlreadyExistedFlag = false;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  node_async.series({
    VALIDATE_PLATFORM_ACCESSES_DATA: cb => {
      let params = {
        platformType: PLATFORM_TYPES.SHOPIFY,
        entityAccessType: ENTITY_ACCESS_TYPES.RETAILER,
        entityRecId: retailerId,
      }
      platformAccesses.getOAuthProfileData(params, (error,result) => {
        if(Object.keys(result).length) recordAlreadyExistedFlag = true
        cb()
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: {flag: recordAlreadyExistedFlag}}));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : For validating whether retailer's shopify OAuth has already performed or not. (For retailer settings)
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
const shopifyOAuthRetailerSettingVerification = async (req, callback) => {
  const { retailerId } = req.params;
  let response
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  node_async.series({
    VALIDATE_RETAILER_SETTINGS_SHOPIFY_ACCESS: cb => {
      retailerLocations.shopifyOAuthRetailerSettingVerification(retailerId, (error,result) => {
        response = result;
        cb()
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: response}));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : For validating whether retailer's google pop-up OAuth has already performed or not.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const localAdvertisingStepTwoOAuthVerification = async (req, callback) => {
  const { retailerId } = req.params;
  let recordAlreadyExistedFlag = false;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  node_async.series({
    VALIDATE_PLATFORM_ACCESSES_DATA: cb => {
      let params = {
        platformType: PLATFORM_TYPES.GOOGLE_BPM,
        entityAccessType: ENTITY_ACCESS_TYPES.RETAILER,
        entityRecId: retailerId,
      }
      platformAccesses.getOAuthProfileData(params, (error,result) => {
        if(Object.keys(result).length) recordAlreadyExistedFlag = true
        cb()
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: {flag: recordAlreadyExistedFlag}}));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : For validating whether retailer's google profile account is already saved or not.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const localAdvertisingStepTwoGMBPProfileAccountsVerification = async (req, callback) => {
  const { retailerId } = req.params;
  let googleProfileAccount;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  node_async.series({
    VALIDATE_G_PLATFORM_ACCESSES_DATA: cb => {
      gPlatformAccess.getGoogleBusinessManagementProfileAccountData(retailerId, (error,result) => {
        googleProfileAccount = result
        cb()
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: googleProfileAccount}));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : for fetching google profile accounts list from google.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const fetchRetailerGMBProfileAccountsFromGoogle = async (req, callback) => {
  const { retailerId } = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  let retailerGoogleAccessToken, retailerGoogleAccounts;
  node_async.series({
    GENERATE_RETAILER_GOOGLE_BPM_ACCESS_TOKEN: cb => generateRetailerAccessToken(retailerId,(error,token)=>{
      if(error) return callback(base.error({message: error}), null);
      retailerGoogleAccessToken = token
      cb();
    }),
    FETCH_RETAILER_GBM_ACCOUNTS: cb => {
      let url = `https://mybusinessaccountmanagement.googleapis.com/v1/accounts`;
      CURL(url, 'get', undefined, retailerGoogleAccessToken, (res)=>{
        if(res?.error) {
          console.log('FETCH_RETAILER_GBM_ACCOUNTS: ERROR',res?.error);
          return callback(base.error({message: 'Oops, we ran into an issue while trying to retrieve Google My Business Profile information. Try again OR contact support@brandslice.io or 703-783-6240.'}), null);
        }
        let responseData = res.accounts
        if(!responseData.length) return callback(base.error({message: "We were unable to find a Google My Business Profile account associated with the account you're logged into Google with. Please ensure you log in with an account that is an Owner or Admin of your Business Profile for your store. Try again OR contact support@brandslice.io or 703-783-6240."}), null);
        retailerGoogleAccounts = responseData.filter(data => {
          return (data.type == 'PERSONAL' || data.type == 'ORGANIZATION')
        })
        if(!retailerGoogleAccounts.length) return callback(base.error({message: "We were unable to find a Google My Business Profile account with type 'PERSONAL' or 'ORGANIZATION' using the account you're logged into Google with.  Please ensure you log in with an account that is an Owner or Admin of your Business Profile for your store.  Try again OR contact support@brandslice.io or 703-783-6240."}), null);
        cb();
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: retailerGoogleAccounts}));
  })
}

/**
 * @Author : Pardeep 
 * @Purpose : For saving retailer's google profile account into DB table.
 * @param {*} req 
 * @param {*} callback 
 */
 const saveRetailerGoogleProfileAccount = async (req, callback) => {
  const { retailerId, accountNumber } = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  if (!accountNumber) return callback(base.error({ error: true, message: "Missing attribute: Account Number" }), null);
  node_async.series({
    CREATE_ENTRY_WITH_GOOGLE_ACCOUNT: cb => {
      let data = {
        [G_PLATFORM_ACCESSES_FIELDS.AD_PLATFORM_TYPE]: 'Google',
        [G_PLATFORM_ACCESSES_FIELDS.ENTITY_ACCESS_TYPE]: 'R',
        [G_PLATFORM_ACCESSES_FIELDS.ACCOUNT_REC_ID]: retailerId,
        [G_PLATFORM_ACCESSES_FIELDS.G_GMB_ACCOUNT_ID]: accountNumber,
        [G_PLATFORM_ACCESSES_FIELDS.LAST_UPDATE_USER]: 'googleAdsEngine'
      };
      gPlatformAccess.createEntryWithGoogleAccountId(data, (error,result) => {
        cb()
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: true}));
  })
}

/**
 * 
 * @Author : Pardeep 
 * @Purpose : For fetching all the location from retailer's googel account.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const getRetailerGoogleLocations = async (req, callback) => {
  const { retailerId, googleAccountId } = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  let retailerGoogleLocations, platformAccessDetails, retailerGoogleAccessToken;
  node_async.series({
    GENERATE_RETAILER_GOOGLE_BPM_ACCESS_TOKEN: cb => generateRetailerAccessToken(retailerId,(error,token)=>{
      if(error) return callback(base.error({message: error}), null);
      retailerGoogleAccessToken = token
      cb();
    }),
    FETCH_GOOGLE_LOCATIONS: cb => {
      let readMaskFields = 'name,storeCode,title,languageCode,phoneNumbers,categories,storefrontAddress,websiteUri,latlng';
      let url = `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${googleAccountId}/locations?readMask=${readMaskFields}`;
      CURL(url, 'get', undefined, retailerGoogleAccessToken, (res)=>{
        if(res?.error || !res?.locations || (res?.locations && !res?.locations.length)) {
          console.log('FETCH_GOOGLE_LOCATIONS: ERROR',res?.error);
          return callback(base.error({message: 'Oops, we ran into an issue while trying to retrieve store location information for your Google My Business Profile account. Try again OR contact support@brandslice.io or 703-783-6240.'}), null);
        }
        retailerGoogleLocations = res?.locations || [];
        cb();
      })
    },
    CHECK_LOCATION_VERIFICATION: cb => {
      if(retailerGoogleLocations.length){
        let scripts = [];
        retailerGoogleLocations.forEach(_obj => {
          const location = _obj["name"].split('/');
          const locationId = location[1];
          locationId && scripts.push(cb => {
            let url = `https://mybusinessverifications.googleapis.com/v1/locations/${locationId}/verifications`;
            CURL(url, 'get', undefined, retailerGoogleAccessToken, (res)=>{
              _obj['verifications'] = res?.verifications?.length ? res?.verifications[0] : {};
              cb();
            })
          })
        })
        node_async.parallel(scripts, () => cb());
      }else{
        cb();
      }
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: retailerGoogleLocations}));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : For validating, whether google locations are already saved or not. 
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
const validatingRetailerSavedGoogleLocations = async (req, callback) => {
  const { retailerId } = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  let retailersavedGoogleLocations;
  let recordAlreadyExistedFlag = false;
  node_async.series({
    FETCH_G_PLATFORM_ACCESS_ENTRIES : cb => {
      let whereCondition = `${G_PLATFORM_ACCESSES_FIELDS.AD_PLATFORM_TYPE} = 'Google' AND
      ${G_PLATFORM_ACCESSES_FIELDS.ENTITY_ACCESS_TYPE} = 'L' AND
      ${G_PLATFORM_ACCESSES_FIELDS.ACCOUNT_REC_ID} = '${retailerId}' AND 
      ${G_PLATFORM_ACCESSES_FIELDS.G_GMB_ACCOUNT_ID} IS NOT NULL`
      gPlatformAccess.fetchGPlatformAccesses(whereCondition, (error, result) => {
        if(result.length) recordAlreadyExistedFlag = true;
        cb();
      })
    },
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: {flag: recordAlreadyExistedFlag}}));
  })
}

/**
 * @Author : Pardeep 
 * Purpose: For requesting and accepting manager access for seleted locations.
 * @Step1: Create location group. 
 * @Step2: Request manage access for location.
 * @Step3: Accept all invitations that has been genereated for retailer admin account ID.
 * @Step3: Save locations into DB tables.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const saveRetailerGoogleLocations = async (req, callback) => {
  const { retailerId, retailerGoogleLocation, lastUpdateUser} = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  if (!retailerGoogleLocation.length) return callback(base.error({ error: true, message: "Please select locations." }), null);
  let systemSettings, googleBpmAccountId, brandSliceGoogleAccessToken, retailerGoogleAccessToken, retailerGoogleInvitations;
  let locationGroupName, locationGroupAccountId, googleProfileAccount,shopifyAccessToken,shopifyShopName;
  let retailerName = ''
  let newlySavedLocationIds = [];
  node_async.series({
    GET_RETAILER_ACCOUNT_DETAILS: cb => {
      let fields = `${RETAILER_ACCOUNTS_FIELDS.INDUSTRY_REC_ID}, ${RETAILER_ACCOUNTS_FIELDS.RETAILER_NAME}`      
      retailerAccounts.getAccountDetails(fields, retailerId,(error, data) => {
        retailerDetails = data
        retailerName = retailerDetails[RETAILER_ACCOUNTS_FIELDS.RETAILER_NAME];
        cb();
      })
    },
    SYSTEM_SETTINGS: cb => {
      systemSettingsCache((error, result) => {
        if(error) return callback(base.error({message: JSON.stringify(error)}), null);
        systemSettings = result;
        googleBpmAccountId = systemSettings['GOOGLE:BPM_ACCOUNT_ID']
        locationGroupName = retailerName+'-'+retailerId
        cb();
      })
    },
    FETCH_RETAILER_GOOGLE_PROFILE_ACCOUNT_DATA_FROM_DB: cb => {
      gPlatformAccess.getGoogleBusinessManagementProfileAccountData(retailerId, (error,result) => {
        googleProfileAccount = result
        cb()
      })
    },
    GET_SHOPIFY_ACCESS_TOKEN: cb => {
      let params = {
        platformType: PLATFORM_TYPES.SHOPIFY,
        entityAccessType: ENTITY_ACCESS_TYPES.RETAILER,
        entityRecId: retailerId,
      }
      platformAccesses.getOAuthProfileData(params, (error,result) => {
        shopifyAccessToken = result.Access_Token
        shopifyShopName = result.Account_ID
        cb()
      })
    },
    SAVE_GOOGLE_LOCATION_DATA_INTO_DB_TABLES: cb => {
      let scripts = [];
      retailerGoogleLocation.map((location)=>{
        scripts.push(cb => {
          let phoneNumber = location?.phoneNumbers?.primaryPhone ? location?.phoneNumbers?.primaryPhone.replace(') ', '-').replace('(', '') : null
          locationId = "";
          existinglocationData = {};
          addressId = "";
          existingAddressData = {};
          node_async.series({
            SAVE_LOCATION: cb => {
              let data = {
                "retailerId": retailerId,
                "businessName": location?.storefrontAddress?.locality || null,
                "website": location?.websiteUri || null,
                "primaryLocationFlag": 'N',
                "fullName": null,
                "phone": phoneNumber || null,
                "radius": 25,
                "longitude": location?.latlng?.longitude || null,
                "latitude": location?.Latlng?.latitude || null,
                "email": lastUpdateUser
              }
              retailerLocations.createLocation(data, (error, result) => {
                if(error) {
                  let emailMessage = `An error was encountered when trying to save the retailer_locations table for location ID ${locationId} and retailer ${retailerId}`;
                  email.welcomeScreenErrorMail(retailerId, retailerName, emailMessage, [], false, () => {});
                  //Returning success. So that, admin can do the remainaing processing later on his end. 
                  return callback( null, base.success({result: { message: true}}));
                }
                locationId = result && result[0] ? result[0] : 0;
                newlySavedLocationIds.push(locationId);
                cb();
              })
            }, 
            SAVE_ADDRESS: cb => {
              let data = {
                [ADDRESSES_FIELDS.ACCOUNT_REC_ID] : locationId,
                [ADDRESSES_FIELDS.ADDRESS_ENTITY_TYPE] : 'L',
                [ADDRESSES_FIELDS.ADDRESS_TYPE] : 'M',
                [ADDRESSES_FIELDS.ADDRESS_LINE_1] : location?.storefrontAddress.addressLines[0] || null,
                [ADDRESSES_FIELDS.ADDRESS_LINE_2] : null,
                [ADDRESSES_FIELDS.ADDRESS_LINE_3] : null,
                [ADDRESSES_FIELDS.ADDRESS_LINE_4] : null,
                [ADDRESSES_FIELDS.CITY] : location?.storefrontAddress?.locality || null,
                [ADDRESSES_FIELDS.STATE] : location?.storefrontAddress?.administrativeArea || null,
                [ADDRESSES_FIELDS.ZIP_CODE] : location?.storefrontAddress?.postalCode || null,
                [ADDRESSES_FIELDS.COUNTRY] : location?.storefrontAddress?.regionCode || null,
                [ADDRESSES_FIELDS.LAST_UPDATE_USER] : lastUpdateUser,
              }
              addresses.add(data, (error, result) => {           
                if (error) {
                  let emailMessage = `An error was encountered when trying to save to the addresses table for location ID ${locationId} and retailer ${retailerId}`;
                  email.welcomeScreenErrorMail(retailerId, retailerName, emailMessage, [], false, () => {});
                  //Returning success. So that, admin can do the remainaing processing later on his end. 
                  return callback( null, base.success({result: { message: true}}));
                }
                cb();
              })
            },
            SAVE_UPDATE_DATA_INTO_G_PLATFORM_ACCESSES: cb => {
              let data = {
                [G_PLATFORM_ACCESSES_FIELDS.AD_PLATFORM_TYPE]: 'Google',
                [G_PLATFORM_ACCESSES_FIELDS.ENTITY_ACCESS_TYPE]: 'L',
                [G_PLATFORM_ACCESSES_FIELDS.ACCOUNT_REC_ID]: retailerId,
                [G_PLATFORM_ACCESSES_FIELDS.STORE_LOCATION_ID]: locationId,
                [G_PLATFORM_ACCESSES_FIELDS.G_GMB_ACCOUNT_ID]: googleProfileAccount.g_gmb_account_id,
                [G_PLATFORM_ACCESSES_FIELDS.G_LOCATION_ID]: location.name.replace('locations/',''),
                [G_PLATFORM_ACCESSES_FIELDS.LAST_UPDATE_USER]: lastUpdateUser                
              };
              gPlatformAccess.createUpdateEntry(data, (error,result) => {
                cb()
              })
            },            
            SAVE_UPDATE_DATA_INTO_STORES_PDP_INFO_TABLE: cb => {
              let existingStorePDPData
              node_async.series({
                GET_FILLED_DATA_SOURCE_COLUMN_VALUE: cb =>{
                  storesPdfInfo.localAdvertisingStepOneVerification(retailerId,(error, data)=>{
                    existingStorePDPData = data;
                    cb()
                  })
                },
                CREATE_UPDATE_ENTRY: cb => {
                  let websiteUrl = existingStorePDPData[STORES_PDP_INFO_FIELDS.SHOPIFY_STORE_NAME];
                  if(location?.websiteUri){
                    let urlObj = new URL(location.websiteUri);
                    websiteUrl = urlObj.hostname
                  }
                  let data = {
                    [STORES_PDP_INFO_FIELDS.RETAILER_REC_ID] : retailerId,
                    [STORES_PDP_INFO_FIELDS.STORE_LOCATION_ID] : locationId,
                    [STORES_PDP_INFO_FIELDS.LOCALLY_STORE_ID] : null,
                    [STORES_PDP_INFO_FIELDS.STORE_NAME] : existingStorePDPData[STORES_PDP_INFO_FIELDS.STORE_NAME] || null,
                    [STORES_PDP_INFO_FIELDS.LIGHTSPEED_ID] : null,
                    [STORES_PDP_INFO_FIELDS.LIGHTSPEED_STORE_NAME] : existingStorePDPData[STORES_PDP_INFO_FIELDS.LIGHTSPEED_STORE_NAME] || null,
                    [STORES_PDP_INFO_FIELDS.INCLUDE_LIGHTSPEED] : 0,
                    [STORES_PDP_INFO_FIELDS.FITTED_STORE_ID] : null,
                    [STORES_PDP_INFO_FIELDS.FITTED_IMPORT_URL] : existingStorePDPData[STORES_PDP_INFO_FIELDS.FITTED_IMPORT_URL] || null,
                    [STORES_PDP_INFO_FIELDS.SHOPIFY_STORE_ID] : null,
                    [STORES_PDP_INFO_FIELDS.SHOPIFY_STORE_NAME] : websiteUrl || null,
                    [STORES_PDP_INFO_FIELDS.BIGCOMM_SITE_ID] : null,
                    [STORES_PDP_INFO_FIELDS.BIGCOMM_STORE_NAME] : existingStorePDPData[STORES_PDP_INFO_FIELDS.BIGCOMM_STORE_NAME] || null,
                  };
                  storesPdfInfo.createUpdateEntry(data,(error, data) => {
                    cb();
                  })
                }
              },()=>cb())
            },
          },(error, result) => {
            cb();
          })
        })
      })
      node_async.series(scripts,()=>cb());
    },
    SAVE_LOCATION_LEVEL_PLATFORM_ACCESS_ENTRIES: cb => {
      node_async.series({
        SAVE_SHOPIFY_AUTH_TOKENS_INTO_DB: cb =>{
          if(shopifyAccessToken){
            let scripts = [];
            newlySavedLocationIds.map((locationId)=>{
              scripts.push(cb => {
                let data = {
                  [PLATFORM_ACCESSES_FIELDS.PLATFORM_TYPE]: PLATFORM_TYPES.SHOPIFY,
                  [PLATFORM_ACCESSES_FIELDS.ENTITY_ACCESS_TYPE]: ENTITY_ACCESS_TYPES.LOCATION,
                  [PLATFORM_ACCESSES_FIELDS.ENTITY_REC_ID]: locationId,
                  [PLATFORM_ACCESSES_FIELDS.ACCESS_TOKEN]: shopifyAccessToken,
                  [PLATFORM_ACCESSES_FIELDS.ACCOUNT_ID]: shopifyShopName,
                  [PLATFORM_ACCESSES_FIELDS.ACCOUNT_MANAGED_BY]: 1
                };
                platformAccesses.createPlatformAccessEntry(data, () => cb())
              });
            });
            node_async.series(scripts,()=>cb());
          }else cb();
        }
      }, (error, result) => {
        cb();
      })
    },
    DELETING_EXISTING_L_TYPE_ENTRY_AND_SETING_UP_PRI: cb =>{
      let primaryRetailerLocationId;
      node_async.series({
        FETCH_EXISTING_L_TYPE_PRIMARY_FLAG_LOCATION_ENTRY: cb =>{
          retailerLocations.fetchExistingPrimayFlagEntry(retailerId, (error,result) => {
            if(Object.keys(result).length) primaryRetailerLocationId = result.Store_Location_ID
            cb();
          })
        },
        DELETE_EXISTING_L_TYPE_LOCATION_ENTRY: cb =>{
          if(primaryRetailerLocationId){
            retailerLocations.deleteLocationById(primaryRetailerLocationId, (error,result) => {
              cb();
            })
          }else cb()
        },
        DELETE_EXISTING_L_TYPE_ADDRESS_ENTRY: cb =>{
          if(primaryRetailerLocationId){
            addresses.deleteAddressByLocationId(primaryRetailerLocationId, (error,result) => {
              cb();
            })
          }else cb()          
        },
        SET_PRIMARY_FLAG_ON_NEWLY_SAVED_LOCATION: cb =>{
          retailerLocations.setPrimaryFlagOnNewlySavedLocation(newlySavedLocationIds[0], (error,result) => {
            cb();
          })        
        },
      }, (error, result)=>{
        cb();
      })
    },
    DELETE_PLATFORM_ACCESS_SHOPIFY_TEMPORARY_DATA: cb =>{
      platformAccesses.deletePlatformAccessEntry(retailerId, ENTITY_ACCESS_TYPES.RETAILER, PLATFORM_TYPES.SHOPIFY, (error,result) => {
        cb();
      })
    },
    DELETE_G_PLATFORM_ACCESS_TEMPORARY_DATA: cb =>{
      if(googleProfileAccount?.access_rec_id){
        gPlatformAccess.deleteEntry(googleProfileAccount?.access_rec_id, (error,result) => {
          cb();
        })
      }else cb();
    },
    DELETE_STORE_PDP_INFO_TEMPORARY_DATA: cb =>{    
      storesPdfInfo.deleteTemporaryData(retailerId,(error, data)=>{
        cb()
        return callback( null, base.success({result: { message: 'Location saved successfully.'}}));
      })
    },
    GENERATE_BRAND_SLICE_GOOGLE_BPM_ACCESS_TOKEN: cb => generateBrandSliceAccessToken(1,(error,token)=>{
      console.log('GENERATE_BRAND_SLICE_GOOGLE_BPM_ACCESS_TOKEN')
      if(error) {
        console.log('GENERATE_BRAND_SLICE_GOOGLE_BPM_ACCESS_TOKEN:ERROR',error)
        return callback(base.error({message: 'Oops, we ran into an issue while trying to retrieve an access token for admin Google My Business Profile account. Try again OR contact support@brandslice.io or 703-783-6240.'}), null); 
      }
      brandSliceGoogleAccessToken = token
      cb()
    }),
    GENERATE_RETAILER_GOOGLE_BPM_ACCESS_TOKEN: cb => generateRetailerAccessToken(retailerId,(error,token)=>{
      console.log('GENERATE_RETAILER_GOOGLE_BPM_ACCESS_TOKEN')
      if(error) {
        console.log('GENERATE_RETAILER_GOOGLE_BPM_ACCESS_TOKEN:ERROR',error)
        return callback(base.error({message: `Oops, we ran into an issue while trying to retrieve an access token for your Google My Business Profile account. Try again OR contact support@brandslice.io or 703-783-6240..`}), null); 
      }
      retailerGoogleAccessToken = token
      cb()
    }),
    FETCH_LOCATION_GROUP_ACCOUNTS: cb => { 
      console.log('FETCH_LOCATION_GROUP_ACCOUNTS')
      //Using callback ieration method.
      fetchLocationAccountGroups(locationGroupName, brandSliceGoogleAccessToken, null, (locationGroupAccount)=>{
        if(locationGroupAccount) locationGroupAccountId = locationGroupAccount.name.replace('accounts/','')
        cb();
      })
    },
    CREATE_LOCATION_GROUP_ACCOUNT: cb => {
      console.log('CREATE_LOCATION_GROUP_ACCOUNT')
      if(!locationGroupAccountId){
        let url = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
        let curlBody = {
          "accountName" : locationGroupName,
          "primaryOwner": `accounts/${googleBpmAccountId}`,
          "type": "LOCATION_GROUP"
        }
        CURL(url, 'post', curlBody, brandSliceGoogleAccessToken, (res)=>{
          locationGroupAccountId = res.name.replace('accounts/','')
          cb();
        })
      }else{
        cb()
      }      
    },
    REQUEST_MANAGER_ACCESS: cb => {
      console.log('REQUEST_MANAGER_ACCESS')
      let scripts = [];
      retailerGoogleLocation.map((data)=>{
        scripts.push(cb => {
          let retailerLocationAdminId;
          let locationId = data.name.replace('locations/','')
          node_async.series({
            // Here we are fetching retailer Location admin ID which is different then retailer account ID.
            FETCH_RETAILERS_GOOGLE_LOCATION_ADMIN_ID: cb => { 
              let url = `https://mybusinessaccountmanagement.googleapis.com/v1/locations/${locationId}/admins`;
              CURL(url, 'get', undefined, retailerGoogleAccessToken, (res)=>{
                if(res?.error) {                  
                  return callback(base.error({message: res?.error?.message || 'Error while fetching location admin.'}), null);
                }
                let retailerLocationAccountData = res.admins.find(el => el.role == 'PRIMARY_OWNER');
                if(!retailerLocationAccountData) return callback(base.error({message: `Location admin account with type 'PRIMARY_OWNER' doesn't exist.`}), null);
                retailerLocationAdminId = retailerLocationAccountData.account.replace('accounts/','')         
                cb();
              })
            },
            REQUEST_MANAGER_ACCESS_API: _cb => {
              let url = `https://mybusinessaccountmanagement.googleapis.com/v1/locations/${locationId}/admins`;
              let curlBody = {
                "name": `locations/${locationId}/admins/${retailerLocationAdminId}`,
                "account": `accounts/${locationGroupAccountId}`,   // Account ID of location group that we are getting back from location group POST API.
                "role": 'MANAGER'
              }
              CURL(url, 'post', curlBody, retailerGoogleAccessToken, (res)=>{
                if(res.error){
                  console.log('REQUEST_MANAGER_ACCESS_API:ERROR',res.error)
                  let emailMessage = `Oops, we ran into an issue while sending an access invitation to get connect to location ID: ${locationId}. Error Message: ${res?.error?.message || 'Unable to fetch error message.'}`;                  
                  email.welcomeScreenErrorMail(retailerId, retailerName, emailMessage, [], false, () => {});
                  //Returning success. So that, admin can do the remainaing processing later on his end. 
                  return callback( null, base.success({result: { message: true}}));
                }
                cb();
              })
            },
          }, () => cb())
        })
      })
      node_async.parallelLimit(scripts,5, () => cb());
    },
    GET_ALL_INVITATIONS: cb => {
      console.log('GET_ALL_INVITATIONS')
      let reTryAttempts = 3;
      let apiCallingDelay = 5000;
      listInvitations(locationGroupAccountId, brandSliceGoogleAccessToken, reTryAttempts, apiCallingDelay, (invitationApiResponse)=>{
        retailerGoogleInvitations = invitationApiResponse?.invitations ? invitationApiResponse?.invitations : [];
        if(!Object.keys(retailerGoogleInvitations).length){
          let emailMessage = `No invitations found on BrandSlice admin account. An error was encountered when trying to look up open invitation for retailerID ${retailerId}`;
          email.welcomeScreenErrorMail(retailerId, retailerName, emailMessage, [], false, () => {});
          // Returning success. So that, admin can do the remainaing processing later on his end. 
          return callback( null, base.success({result: { message: true}}));
        }
        if(retailerGoogleInvitations?.error){
          let emailMessage = `Error while fetching invitations for retailerID ${retailerId}. Error: ${retailerGoogleInvitations?.error?.message || 'Unable to fetch error message.' }`;
          email.welcomeScreenErrorMail(retailerId, retailerName, emailMessage, [], false, () => {});
          // Returning success. So that, admin can do the remainaing processing later on his end. 
          return callback( null, base.success({result: { message: true}}));
        }
        cb();
      })
    },
    ACCEPT_EACH_INVITATIONS: cb => {
      console.log('ACCEPT_EACH_INVITATIONS')
      let scripts = [];
      retailerGoogleInvitations.length && retailerGoogleInvitations.map((invitation)=>{
        scripts.push(cb => {
          let invitationId = invitation.name.split("/");
          invitationId = invitationId[3];
          let url = `https://mybusinessaccountmanagement.googleapis.com/v1/accounts/${locationGroupAccountId}/invitations/${invitationId}:accept`;
          CURL(url, 'post', {}, brandSliceGoogleAccessToken, (res)=>{
            if(res?.error) {
              console.log('ACCEPT_EACH_INVITATIONS:ERROR',res?.error)
              let emailMessage = `An error was encountered when trying to accept a location group invitation for invitation ID ${locationID} and retailer ${retailerId}. Error Message: ${res?.error?.message || 'Unable to fetch error message.'}`;
              email.welcomeScreenErrorMail(retailerId, retailerName, emailMessage, [], false, () => {});
              //Returning success. So that, admin can do the remainaing processing later on his end. 
              return callback( null, base.success({result: { message: true}}));
            }
            cb();
          })
        })
      })
      node_async.parallelLimit(scripts,5, () => cb());
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    let emailMessage = 'This retailer connected their Google Business Profile account and linked their account to a new location group.';
    email.welcomeScreenErrorMail(retailerId, retailerName, emailMessage, retailerGoogleLocation, true, () => {});
    return callback( null, base.success({result: { message: 'Location saved successfully.'}}));
  })
}

/**
 * @Author : Pardeep 
 * Purpose: For saving shopify selected locations into store PDP.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
const saveRetailerShopifyStorePdpData = async (req, callback) => {
  const { retailerId, retailerLocations, accessToken, shop} = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  if (!retailerLocations.length) return callback(base.error({ error: true, message: "Please select locations." }), null);
  node_async.series({
    DELETE_STORE_PDP_INFO_TEMPORARY_DATA: cb =>{   
      storesPdfInfo.deleteRetailerEntries(retailerId,(error, data)=>{
        cb()
      })
    },
    SAVE_LOCATION_ENTRIES_INSTORE_PDP_TABLES: cb => {
      let scripts = [];
      retailerLocations.map((location)=>{
        scripts.push(cb => {
          let websiteUrl = "TEMP";
          if(location.Retailer_Website_URL){
            let urlObj = new URL(location.Retailer_Website_URL);
            websiteUrl = urlObj.hostname
          }          
          let data = {
            [STORES_PDP_INFO_FIELDS.RETAILER_REC_ID] : retailerId,
            [STORES_PDP_INFO_FIELDS.STORE_LOCATION_ID] : location.Store_Location_ID,
            [STORES_PDP_INFO_FIELDS.SHOPIFY_STORE_NAME] : websiteUrl || null,
          };
          storesPdfInfo.createUpdateEntry(data,(error, data) => {
            cb();
          })
        })
      })
      node_async.series(scripts,()=>cb());
    },
    DELETE_EXISTING_GOOGLE_AUTH_TOKENS_FROM_DB: cb =>{
      platformAccesses.deletePlatformAccessEntry(retailerId, ENTITY_ACCESS_TYPES.RETAILER, PLATFORM_TYPES.SHOPIFY, (error,result) => {
        cb();
      })
    },
    SAVE_SHOPIFY_AUTH_TOKENS_INTO_DB: cb =>{
      let scripts = [];
      retailerLocations.map((location)=>{
        scripts.push(cb => {
          let data = {
            [PLATFORM_ACCESSES_FIELDS.PLATFORM_TYPE]: PLATFORM_TYPES.SHOPIFY,
            [PLATFORM_ACCESSES_FIELDS.ENTITY_ACCESS_TYPE]: ENTITY_ACCESS_TYPES.LOCATION,
            [PLATFORM_ACCESSES_FIELDS.ENTITY_REC_ID]: location.Store_Location_ID,
            [PLATFORM_ACCESSES_FIELDS.ACCESS_TOKEN]: accessToken,
            [PLATFORM_ACCESSES_FIELDS.ACCOUNT_ID]: shop,
            [PLATFORM_ACCESSES_FIELDS.ACCOUNT_MANAGED_BY]: 1
          };
          platformAccesses.createPlatformAccessEntry(data, () => cb())
        });
      });
      node_async.series(scripts,()=>cb());
    },
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: { message: 'Location saved successfully.'}}));
  })
}


/**
 * Purpose: To hit location group list API in iteration form using callback. (We can't get all location groups in single response.)
 * @param {*} locationGroupName 
 * @param {*} brandSliceGoogleAccessToken 
 * @param {*} nextPageToken 
 * @param {*} callback 
 */
 const fetchLocationAccountGroups = (locationGroupName, brandSliceGoogleAccessToken, nextPageToken, callback)=>{
  let pageToken = "";
  if(nextPageToken) pageToken = `&pageToken=${nextPageToken}`
  let url = `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?filter=type=LOCATION_GROUP${pageToken}`;
  CURL(url, 'get', undefined, brandSliceGoogleAccessToken, (locationGoups)=>{
    if(locationGoups?.accounts && locationGoups?.accounts.length && locationGoups?.nextPageToken){
      let locationGroupAccount = locationGoups?.accounts.find(obj => obj.accountName === locationGroupName);
      if(!locationGroupAccount && locationGoups?.nextPageToken){
        fetchLocationAccountGroups(locationGroupName, brandSliceGoogleAccessToken, locationGoups?.nextPageToken, callback)
      }
      if(locationGroupAccount){
        callback(locationGroupAccount)
      }
    }else{
      callback(null)
    }
  })
}

/**
 * Purpose: To get invitation list with multiple retries.
 * @param {*} locationGroupAccountId 
 * @param {*} brandSliceGoogleAccessToken 
 * @param {*} reTryAttempts
 * @param {*} apiCallingDelay 
 * @param {*} callback 
 */
 const listInvitations = (locationGroupAccountId, brandSliceGoogleAccessToken, reTryAttempts, apiCallingDelay, callback)=>{
  console.log('------------reTryAttempts-----------',reTryAttempts)
  let url = `https://mybusinessaccountmanagement.googleapis.com/v1/accounts/${locationGroupAccountId}/invitations`;    // Account ID of location group that we are getting back from location group POST API.
  setTimeout(()=>{
    CURL(url, 'get', undefined, brandSliceGoogleAccessToken, (res)=>{
      if(!Object.keys(res).length && reTryAttempts != 1){
        console.log('--------before--------')
        return listInvitations(locationGroupAccountId, brandSliceGoogleAccessToken, (reTryAttempts-1), apiCallingDelay, callback)
      }
      if(Object.keys(res).length || reTryAttempts == 1){
        console.log('--------after--------')
        return callback(res)
      }
    })
  }, apiCallingDelay);
}

/**
 * @Author : Pardeep 
 * @Purpose : Common function to re-generate brand-slcie google aOAuth access token from refresh token.
 * @param {*} brandSliceId 
 * @param {*} callback 
 */
const generateBrandSliceAccessToken = (brandSliceId, callback)=> {
  let systemSettings;  
  node_async.series({
    SYSTEM_SETTINGS: cb => {
      systemSettingsCache((error, result) => {
        if(error) return callback(base.error({message: JSON.stringify(error)}), null);
        systemSettings = result;
        cb();
      })
    },
    RE_GENERATE_BRAND_SLICE_GOOGLE_BPM_ACCESS_TOKEN: cb => {        
      let url = "https://www.googleapis.com/oauth2/v4/token";
      let curlBody = {
        "client_id": systemSettings['GOOGLE_OAUTH_CLIENT_ID'],
        "client_secret": systemSettings['GOOGLE_OAUTH_SECRET'],
        "refresh_token": systemSettings['GOOGLE:BP_ADMIN_REFRESH_TOKEN'],
        "grant_type":"refresh_token"
      }
      CURL(url, 'post', curlBody, null, (res)=>{
        if(res?.error) {
          console.log('GENERATE_ACCESS_TOKEN_FROM_REFRESH_TOKEN: ERROR',res?.error);
          return callback("Error while re-generating access token.", null);
        }
        brandSliceGoogleAccessToken = res.access_token
        cb();
      })
    },
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, brandSliceGoogleAccessToken);
  })
}

/**
 * @Author : Pardeep 
 * @Purpose : Common function to re-generate retailer google aOAuth access token from refresh token.
 * @param {*} retailerId 
 * @param {*} callback 
 */
const generateRetailerAccessToken = (retailerId, callback)=> {        
  let systemSettings;
  node_async.series({
    SYSTEM_SETTINGS: cb => {
      systemSettingsCache((error, result) => {
        if(error) return callback(base.error({message: JSON.stringify(error)}), null);
        systemSettings = result;
        cb();
      })
    },
    GET_RETAILER_GOOGLE_BPM_ACCESS_TOKEN: cb => {      
      let params = {
        platformType: PLATFORM_TYPES.GOOGLE_BPM,
        entityAccessType: ENTITY_ACCESS_TYPES.RETAILER,
        entityRecId: retailerId,
      }
      platformAccesses.getOAuthProfileData(params, (error,result) => {
        if(!Object.keys(result).length) return callback("Gogole authentication process has not been done yet. Please contact out customer supper if you have already done that proocess.", null);
        retailerPlatformAccessDetails = result
        cb()
      })
    },
    RE_GENERATE_RETAILER_GOOGLE_BPM_ACCESS_TOKEN: cb => {        
      let url = "https://www.googleapis.com/oauth2/v4/token";
      let curlBody = {
        "client_id": systemSettings['GOOGLE_OAUTH_CLIENT_ID'],
        "client_secret": systemSettings['GOOGLE_OAUTH_SECRET'],
        "refresh_token": retailerPlatformAccessDetails['Refresh_token'],
        "grant_type":"refresh_token"
      }
      CURL(url, 'post', curlBody, null, (res)=>{
        if(res?.error) {
          console.log('GENERATE_ACCESS_TOKEN_FROM_REFRESH_TOKEN: ERROR',res?.error);
          return callback("Error while re-generating access token.", null);
        }
        retailerGoogleAccessToken = res.access_token
        cb();
      })
    },
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, retailerGoogleAccessToken);
  })
}

/**
 * @Author : Pardeep
 * @Purpose : For updating flag alue of welcome-scrren in retailer acoount table.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const setWelcomeScreenFlag = async (req, callback) => {
  const { retailerId } = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID" }), null);
  node_async.series({
    UPDATE_WELCOME_SCREEN_FLAG: cb => {
      retailerAccounts.updateWelcomeScreenFlag(retailerId ,(error, data) => {
        cb();
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: true }));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : Get the list of industries
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
const listIndustries = async (req, callback) => {
  let industryList = [];
  node_async.series({
    GET_INDUSTRY_LIST: cb => {
      industries.listIndustries((error, data) => {
        industryList = data
        cb();
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: error}), null);
    return callback( null, base.success({result: industryList }));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : For updating flag alue of welcome-scrren in retailer acoount table.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
const updateRetailerIndustry = async (req, callback) => {
  const { retailerId, industryId } = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID." }), null);
  if (!industryId) return callback(base.error({ error: true, message: "Missing attribute: Industry ID." }), null);
  node_async.series({
    VALIDATE_INDUSTRY: cb => {
      industries.getIndustryDetails(industryId, (error, data) => {
        if(!Object.keys(data).length) return callback(base.error({ error: true, message: "Invalid industry selected. Please try again OR contact support@brandslice.io or 703-783-6240." }), null);
        cb();
      })
    },
    UPDATE_RETAILER_INDUSTRY_ID: cb => {
      retailerAccounts.updateIndustry(retailerId, industryId, (error, data) => {
        if(error) return callback(base.error({ error: true, message: "Something went wrong wile updaing industry data. Please try again OR contact support@brandslice.io or 703-783-6240." }), null);
        cb();
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: 'Something went wrong. Please contact support@brandslice.io or 703-783-6240.'}), null);
    return callback( null, base.success({result: true }));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : Get the list of industries
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
const getIndustryBrandAccounts = async (req, callback) => {
  const { industryId } = req.params;
  if (!industryId) return callback(base.error({ error: true, message: "Missing attribute: Industry ID." }), null);
  let brandAccountsList = [];
  node_async.series({
    GET_INDUSTRY_BRAND_ACCOUNTS: cb => {
      brandAccounts.getIndustryBrandAccounts(industryId,(error, data) => {
        brandAccountsList = data
        cb();
      })
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: 'Something went wrong. Please contact support@brandslice.io or 703-783-6240.'}), null);
    return callback( null, base.success({result: brandAccountsList }));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : To save brand authorized retails.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
 const saveBrandAuthorizedRetailerData = async (req, callback) => {
  const { brandAccounts, retailerId } = req.params;
  if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID." }), null);
  if (!brandAccounts.length) return callback(base.error({ error: true, message: "Missing attribute: brandAccounts." }), null);
  let retailerDetails;
  node_async.series({
    VALIDATE_RETAILER: cb => {
      retailerAccounts.retailerAccountDetails(retailerId,(error, data) => {
        retailerDetails = data
        if(!Object.keys(retailerDetails).length) return callback(base.error({ error: true, message: "Error fetching retailer details. Please try again OR contact support@brandslice.io or 703-783-6240." }), null);
        cb();
      })
    },
    SAVE_BRAND_ACCOUNTS: cb =>{
      let scripts = [];
      brandAccounts.length && brandAccounts.forEach((brandAccountId)=>{
        scripts.push(cb =>{
          let isDataFound = false;
          node_async.series({
            VALIDATE_DATA: cb =>{
              let whereCondition = `${BAR_FIELDS.BRAND_REC_ID} = ${brandAccountId} AND
                ${BAR_FIELDS.PRIMARY_RETAILER_FLAG} = 'Y' AND
                ${BAR_FIELDS.RETAILER_NAME} = '${retailerDetails.Retailer_Name}' AND
                ${BAR_FIELDS.RETAILER_REC_ID} = ${retailerId}`;              
              brandAuthorizedRetailers.fetchSingle(whereCondition, (error, data)=>{
                if(Object.keys(data).length) isDataFound = true
                cb();
              })
            },
            SAVE_DATA: cb =>{
              if(!isDataFound){
                let data = {
                  [BAR_FIELDS.BRAND_REC_ID]: brandAccountId,
                  [BAR_FIELDS.PRIMARY_RETAILER_FLAG]: 'Y',
                  [BAR_FIELDS.RETAILER_NAME]: retailerDetails.Retailer_Name,
                  [BAR_FIELDS.RETAILER_REC_ID]: retailerId,
                  [BAR_FIELDS.STATUS]: 'Active',
                }
                brandAuthorizedRetailers.insertNewEntry(data, (error, data)=>{
                    if(error) return callback(base.error({ error: true, message: "Error while saving brand authorized retaailer data. Please try again OR contact support@brandslice.io or 703-783-6240." }), null);
                  cb();
                })
              }else{
                cb();
              }
            }
          }, () => cb())
        })
      })
      node_async.parallel(scripts, () => cb());
    }
  }, (error, result) => {
    if(error) return callback(base.error({message: 'Something went wrong. Please contact support@brandslice.io or 703-783-6240.'}), null);
    return callback( null, base.success({result: true }));
  })
}

/**
 * @Author : Pardeep
 * @Purpose : To merge logo into image.
 * @param {*} req 
 * @param {*} callback 
 * @returns 
 */
const mergeLogo = async (req, callback) => {
  let { upc, input_image, tag_type } = req.params;
  if (!upc) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID." }), null);
  if (!input_image) return callback(base.error({ error: true, message: "Missing attribute: brandAccounts." }), null);
  if (!tag_type) return callback(base.error({ error: true, message: "Missing attribute: tag type." }), null);
  let s3Image ,systemSetting ,inStorePickUp ,shopFbData, compositeImageUrl = '';
  const urlObj = new URL(input_image);
  urlObj.search = '';
  urlObj.hash = '';
  input_image = urlObj.toString();
  node_async.series({
    SYSTEM_SETTINGS: cb => {
      systemSettingsCache((error, result) => {
        if(error) return callback(base.error({message: JSON.stringify(error)}), null);
        systemSetting = result;
        cb();
      })
    },
    GET_SHOP_FB_IMAGE_DB_DATA: cb => {
      shopFbImages.fetchSingleData(upc, (error, data)=>{
        shopFbData = data;
        if(shopFbData){
          return callback( null, base.success({result: shopFbData?.image_path }));
        }
        cb();
      })
    },
    CONVERT_S3_TO_BUFFER: cb =>{
      axios({ url: input_image, responseType: "arraybuffer" }).then((imageData)=>{
        s3Image = imageData.data        
        axios({ url: `${systemSetting['S3_Storage_Path']}Assets/fb_overlay_image.png`, responseType: "arraybuffer" }).then((logData)=>{
          inStorePickUp = logData.data
          cb();
        })
      })
    },
    MERGE_IMAGE: cb => {
      sharp(s3Image).resize({ height: 640, width: 640 }).composite([ { input: inStorePickUp, top: 535, left: 30 }]).toBuffer()
      .then( data => { 
        const s3 = new AWS.S3({
          accessKeyId: systemSetting[FIELDS.AWS.ACCESS_KEY_ID],
          secretAccessKey: systemSetting[FIELDS.AWS.SECRET_KEY]
        });
        // Uploading files to the bucket
        s3.putObject({ Bucket: `${systemSetting['S3_Bucket_Name']}/facebook_shop_images`, Key: `${upc}.${input_image.split(".").pop()}`, Body: data, ContentType: 'binary/octet-stream' }).promise().then((data)=>{
          compositeImageUrl = `${systemSetting['S3_Storage_Path']}facebook_shop_images/${upc}.${input_image.split(".").pop()}`
          cb()
        }).catch((error)=>{
          if(error) return callback(base.error({message: 'Error while saving image into S3'}), null);
          cb()
        })  
       })
      .catch( error => { 
        if(error) return callback(base.error({message: 'Error while screating buffer.'}), null);
        cb()
       });
    },
    SAVE_ENTRY: cb =>{
      let dbData = {
        [SHOP_FB_IMAGES_FIELDS.UPC] : upc,
        [SHOP_FB_IMAGES_FIELDS.IMAGE_PATH] : compositeImageUrl,
      }
      shopFbImages.saveEntry(dbData, (error, data)=>{
        cb();
      })
    },
  }, (error, result) => {
    if(error) return callback(base.error({message: 'Something went wrong. Please contact support@brandslice.io or 703-783-6240.'}), null);
    return callback( null, base.success({result: compositeImageUrl }));
  })
}
/**
* @Author : Pardeep
* @Purpose : To get temporary entry of store PDP.
* @param {*} req 
* @param {*} callback 
* @returns 
*/
const getStorePDPTempEntry = async (req, callback) => {
 let { retailerId } = req.params;
 if (!retailerId) return callback(base.error({ error: true, message: "Missing attribute: Retailer ID." }), null);
 let storePDPTemEntry
 node_async.series({
  GET_FILLED_DATA_SOURCE_COLUMN_VALUE: cb =>{
    storesPdfInfo.getTemporaryEntry(retailerId,(error, data)=>{
      storePDPTemEntry = data;
      cb()
    })
  }
 }, (error, result) => {
   if(error) return callback(base.error({message: 'Something went wrong. Please contact support@brandslice.io or 703-783-6240.'}), null);
   return callback( null, base.success({result: storePDPTemEntry }));
 })
}

module.exports = {
  getRetailerAccountDetails,
  localAdvertisingStepOneVerification,
  saveInventoryDataScource,
  generateSaveShopifyOAuthToken,
  shopifyOAuthVerification,
  localAdvertisingStepTwoOAuthVerification,
  localAdvertisingStepTwoGMBPProfileAccountsVerification,
  fetchRetailerGMBProfileAccountsFromGoogle,
  validatingRetailerSavedGoogleLocations,
  saveRetailerGoogleProfileAccount,
  getRetailerGoogleLocations,
  saveRetailerGoogleLocations,
  saveRetailerShopifyStorePdpData,
  setWelcomeScreenFlag,
  listIndustries,
  updateRetailerIndustry,
  getIndustryBrandAccounts,
  saveBrandAuthorizedRetailerData,
  mergeLogo,
  shopifyOAuthRetailerSettingVerification,
  getStorePDPTempEntry
}

/**
 * @Author : Pardeep 
 * @Purpose : Common function to hit CURL request of any type.
 * @param {*} url 
 * @param {*} method 
 * @param {*} body 
 * @param {*} token 
 * @param {*} cb 
 */
const CURL = (url, method, body, token, cb) =>{
  fetch(url, {
    method: method,
    ...(body) && {body: JSON.stringify(body)},
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  })
  .then(res => res.json()).then(json =>{
    cb(json);
  });
}