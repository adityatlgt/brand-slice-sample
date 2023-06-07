import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Global } from "./../../global";
import { Spinner } from './../../core/spinner';
import { Helper } from './../../core/helper';
declare var $: any;
@Component({
  selector: 'app-google-access',
  templateUrl: './google-access.component.html',
  styleUrls: ['./google-access.component.scss']
})
export class GoogleComponent {

  @Input() retailerId: string;
  popup: any;
  validAccess = false;
  getSystemSettingsval = {};
  authorizeURL = '';
  globalURLs
  googleRedirectUri
  googleAuthScope = "https://www.googleapis.com/auth/business.manage";
  actionDisabled = false;
  errorMessage = "";
  constructor(private global: Global, private spinner: Spinner, private helper: Helper) {
    this.globalURLs = this.global.getGlobalUrls();
    this.global.getSystemSettings((systemSettingValues) => {
      this.getSystemSettingsval = systemSettingValues;
      this.googleRedirectUri = encodeURIComponent(this.globalURLs['baseURL'] + 'assets/access/google.html');
      this.authorizeURL = `https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&scope=${this.googleAuthScope}&response_type=code&client_id=${systemSettingValues['GOOGLE_OAUTH_CLIENT_ID']}&redirect_uri=${this.googleRedirectUri}`;
    })
  }

  ngOnChanges(changes: any) {
    if (changes.retailerId && changes.retailerId.currentValue) {
      this.retailerId = changes.retailerId.currentValue;
      if (this.retailerId) this.getGoogleToken();
    }
  }

  /**
   * Purpose: For fetching google access token from DB.
   */
  getGoogleToken() {
    this.spinner.show();
    const apiURL = `api/retailer/localAdvertisingStepTwoOAuthVerification?retailerId=${this.retailerId}`;
    this.global.getAPI(apiURL, (resp) => {
      if (resp?.status?.error) this.showError(resp?.status?.message);
      if (resp && resp.result.flag) this.validAccess = true;
      this.spinner.hide();
    })
  }

  validateToken() {
    this.validAccess = true;
  }

  /**
    * For generating authentication 'code' from google login.
    * Step-1: Generate 'code'
    * Step-2: Generate access token from 'code'.
    * @author Pardeep
    */

  doLogin() {
    let request_url = this.authorizeURL;
    this.popup = window.open(null, '_blank', 'height=600,width=800,left=250,top=100,resizable=yes');
    this.authorize(request_url, (response) => {
      if (response && response.code) {
        this.showAuthLoader('google-oauth-loader');
        this.generateAndSaveGoogleToken(response.code, (resp) => {
          this.hideAuthLoader('google-oauth-loader');
          if (resp?.status?.error) {
            $('#googleAuthenticationErrorModal').show();
          }
          else this.validateToken();
        })
      } else {
        this.showError("Unable to connect to your Google Business Profile account. Please try again or contact our support at support@brandslice.io or 703-783-6240.");
      }
    });
  }

  /**
   * Purpose: For generating access and refresh tokens from google 'code'.
   * @param code 
   * @param cb 
   */
  generateAndSaveGoogleToken(code, cb) {
    let params = {
      retailerId: this.retailerId,
      code: code,
      redirectUri: this.globalURLs['baseURL'] + 'assets/access/google.html',
    }
    const apiURL = `api/login/generateGoogleOAuthToken`;
    this.global.postAPI(apiURL, params, (data) => {
      cb(data)
    })
  }

  /**
   * Purpose: To authorize google account access.
   * @author Pardeep
   */

  authorize(url, callback) {
    this.popup.location.href = url;
    var wait = () => {
      setTimeout(() => {
        this.popup && this.popup.closed ? this.getOAuthAccessCode(this.popup.location.search, callback) : wait();
      }, 25);
    };
    wait();
  }

  /**
   * Purpose: To get access token from the URL.
   * @author Pardeep
   */

  getOAuthAccessCode(searchString, callback) {
    let allData = this.getUrlQueryObject(searchString);
    callback(allData);
  }

  /**
   * Purpose: Convert query prams into object.
   * @author Pardeep
   */

  getUrlQueryObject(query_string) {
    var vars = {}, hash;
    if (!query_string) {
      return false;
    }
    var hashes = query_string.slice(1).split('&');
    for (var i = 0; i < hashes.length; i++) {
      hash = hashes[i].split('=');
      vars[hash[0]] = hash[1];
    }
    return vars;
  }

  /**
   * Purpose: To close modal.
   * @param id 
   */
  closeModal(id) {
    $(`#${id}`).hide();
  }

  /**
   * Purpose: Common funcion to display errors with auto-hide feature.
   * @param errorMessage 
   */
  showError(errorMessage) {
    this.errorMessage = errorMessage;
    let mainThis = this
    setTimeout(function () {
      mainThis.errorMessage = "";
    }, 10000);
  }

  /**
   * Purpose: To show auth loader.
   * @param divId 
   */
  showAuthLoader(divId) {
    this.actionDisabled = true;
    document.getElementById(divId).classList.remove('d-none');
  }

  /**
   * Purpose: To hide auth loader.
   * @param divId 
   */
  hideAuthLoader(divId) {
    this.actionDisabled = false;
    document.getElementById(divId).classList.add('d-none');
  }
}
