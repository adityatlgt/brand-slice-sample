<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Google\Ads\GoogleAds\Lib\V13\GoogleAdsClient;
use Google\Ads\GoogleAds\Lib\V13\GoogleAdsException;
use Google\Ads\GoogleAds\Util\FieldMasks;
use Google\Ads\GoogleAds\Util\V13\ResourceNames;
use Google\Ads\GoogleAds\V13\Common\AdTextAsset;
use Google\Ads\GoogleAds\V13\Common\ResponsiveSearchAdInfo;
use Google\Ads\GoogleAds\V13\Enums\AdGroupAdStatusEnum\AdGroupAdStatus;
use Google\Ads\GoogleAds\V13\Enums\ServedAssetFieldTypeEnum\ServedAssetFieldType;
use Google\Ads\GoogleAds\V13\Resources\Ad;
use Google\Ads\GoogleAds\V13\Resources\AdGroupAd;
use Google\Ads\GoogleAds\V13\Services\AdGroupAdOperation;
use Google\Ads\GoogleAds\V13\Services\AdOperation;
use Google\ApiCore\ApiException;
use Illuminate\Validation\ValidationException;

class GoogleAdController extends Controller{
    
	public function createAd(Request $request){
        try {
            $this->validateAddAd($request);
            $this->setGoogleClient($request);
      
            $body = $request->all();
      
            try{
              return self::addAd($this->googleClient, $body);
            } 
            catch(GoogleAdsException $googleAdsException){
                return $this->catchGoogleError($googleAdsException);
            }
            catch (ApiException $apiException) {
                return $this->catchOtherError($apiException);
            }
        } 
        catch (ValidationException $e) { 
            return $this->catchValidationsError($e);
        }
        catch (\Throwable $e) { 
         return $this->catchThrowableError($e);
        }
	}


	public function updateAd(Request $request){
        $this->validateUpdateAd($request);
        $this->setGoogleClient($request);

        $body = $request->all();

        try{
            return self::update($this->googleClient, $body);
        } 
        catch(GoogleAdsException $googleAdsException){
            return $this->catchGoogleError($googleAdsException);
        }
        catch (ApiException $apiException) {
            return $this->catchOtherError($apiException);
        }
	}



    public function getAllAds(Request $request){
        try {
            $this->validateGetCall($request);
            $this->setGoogleClient($request);
          
            try{
              return self::getAds($this->googleClient, $request);
            } 
            catch(GoogleAdsException $googleAdsException){
                return $this->catchGoogleError($googleAdsException);
            }
            catch (ApiException $apiException) {
                return $this->catchOtherError($apiException);
            }
          } 
        catch (ValidationException $e) { 
            return $this->catchValidationsError($e);
        }
        catch (\Throwable $e) { 
            return $this->catchThrowableError($e);
        }
	}


    private function validateAddAd(Request $request){
        $this->validate($request, [
          'customerId' => 'required',
          'adGroupId' => 'required',
          'headline' => 'required',
          'description' => 'required',
          'finalURLs' => 'required'
        ]);
    }


    private function validateUpdateAd(Request $request){
        $this->validate($request, [
          'customerId' => 'required',
          'adGroupId' => 'required',
          'adId' => 'required',
          'status' => 'required'
        ]);
    }

    private function validateGetCall(Request $request){
        $this->validate($request, [
          'customerId' => 'required'
        ]);
    }


    /**
     * Function to be used to create Ad Group
     * @author Anshu Singh
     */

    private static function addAd(GoogleAdsClient $googleAdsClient, $body) {
        $customerId = $body['customerId'];
        $adGroupId = $body['adGroupId'];
        $headline = $body['headline'];
        $description = $body['description'];
        $finalURLs = $body['finalURLs'];
        $status = isset($body['status']) ? $body['status'] : AdGroupAdStatus::PAUSED;

        $formattedHeadline = [];
        foreach ($headline as $value) {
            array_push($formattedHeadline, self::createAdTextAsset($value));
        }

        $formattedDescription = [];
        foreach ($description as $value) {
            array_push($formattedDescription, self::createAdTextAsset($value));
        }

        // Creates an ad and sets responsive search ad info.
        $ad = new Ad([
            'responsive_search_ad' => new ResponsiveSearchAdInfo([
                'headlines' => $formattedHeadline,
                'descriptions' => $formattedDescription
            ]),
            'final_urls' => $finalURLs
        ]);

        // Creates an ad group ad to hold the above ad.
        $adGroupAd = new AdGroupAd([
            'ad_group' => ResourceNames::forAdGroup($customerId, $adGroupId),
            'status' => $status,
            'ad' => $ad
        ]);

        // Creates an ad group ad operation.
        $adGroupAdOperation = new AdGroupAdOperation();
        $adGroupAdOperation->setCreate($adGroupAd);

        // Issues a mutate request to add the ad group ad.
        $adGroupAdServiceClient = $googleAdsClient->getAdGroupAdServiceClient();
        $response = $adGroupAdServiceClient->mutateAdGroupAds($customerId, [$adGroupAdOperation]);
        $resourceName = $response->getResults()[0]->getResourceName();
        $id = self::getSubIdFromResource($resourceName);
        return response()->json(["id"=> $id]);

    }



    /**
     * Function to be used to create Ad Group
     * @author Anshu Singh
     */

    private static function update(GoogleAdsClient $googleAdsClient, $body) {
        $customerId = $body['customerId'];
        $adGroupId = $body['adGroupId'];
        $adId = $body['adId'];
        $status = isset($body['status']) ? $body['status'] : AdGroupAdStatus::PAUSED;

        // Creates ad group ad resource name.
        $adGroupAdResourceName = ResourceNames::forAdGroupAd($customerId, $adGroupId, $adId);

        // Creates an ad and sets its status to PAUSED.
        $adGroupAd = new AdGroupAd();
        $adGroupAd->setResourceName($adGroupAdResourceName);
        $adGroupAd->setStatus($status);

        // Constructs an operation that will pause the ad with the specified resource name,
        // using the FieldMasks utility to derive the update mask. This mask tells the Google Ads
        // API which attributes of the ad group you want to change.
        $adGroupAdOperation = new AdGroupAdOperation();
        $adGroupAdOperation->setUpdate($adGroupAd);
        $adGroupAdOperation->setUpdateMask(FieldMasks::allSetFieldsOf($adGroupAd));

        // Issues a mutate request to pause the ad group ad.
        $adGroupAdServiceClient = $googleAdsClient->getAdGroupAdServiceClient();
        $response = $adGroupAdServiceClient->mutateAdGroupAds(
            $customerId,
            [$adGroupAdOperation]
        );
        $resourceName = $response->getResults()[0]->getResourceName();
        $id = self::getSubIdFromResource($resourceName);
        return response()->json(["id"=> $id]);

    }

    private static function getAds(GoogleAdsClient $googleAdsClient, $request) {
        $customerId = $request->query('customerId');

        $googleAdsServiceClient = $googleAdsClient->getGoogleAdsServiceClient();

        $query = "SELECT ad_group_ad.ad.id, ad_group.id
            FROM ad_group_ad";


        $response = $googleAdsServiceClient->search($customerId, $query);

        // Iterates over all rows in all pages and prints the requested field values for
        // the expanded text ad in each row.
        $return = [];
        foreach ($response->iterateAllElements() as $googleAdsRow) {
            /** @var GoogleAdsRow $googleAdsRow */
            $ad = $googleAdsRow->getAdGroupAd()->getAd();
            array_push($return, $ad->getId());
        }
       
        return response()->json(["list"=> $return]);
    }



     /**
     * Creates an ad text asset with the specified text and pin field enum value.
     *
     * @param string $text the text to be set
     * @param int|null $pinField the enum value of the pin field
     * @return AdTextAsset the created ad text asset
     */
    private static function createAdTextAsset(string $text, int $pinField = null): AdTextAsset{
        $adTextAsset = new AdTextAsset(['text' => $text]);
        if (!is_null($pinField)) {
            $adTextAsset->setPinnedField($pinField);
        }
        return $adTextAsset;
    }


}