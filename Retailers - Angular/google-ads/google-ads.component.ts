import { Component, Input, OnInit } from '@angular/core';
import * as moment from 'moment';
import { UserService } from 'src/app/core';
import * as CanvasJS from '../../../assets/js/canvasjs.min';
import { Helper } from "../../core/helper";

@Component({
  selector: 'app-google-ads',
  templateUrl: './google-ads.component.html',
  styleUrls: ['./google-ads.component.scss']
})
export class GoogleAdsReportingComponent implements OnInit {

  @Input() googleAdsSearchReport = [];
  @Input() googleAdsAccountReport = {};
  @Input() googleAdsAgeReport = {};
  @Input() googleAdsGenderReport = {};
  @Input() googleAdsStatsReport = [];
  @Input() googleAdsGeoReport = [];
  @Input() googleAdsProductReport = [];
  @Input() selectedGCampaign = 0;
  @Input() googleAdsSearchLoading = true;
  @Input() googleAdsAccountLoading = true;
  @Input() googleAdsAgeLoading = true;
  @Input() googleAdsGenderLoading = true;
  @Input() googleAdsGeoLoading = true;
  @Input() googleAdsProductLoading = true;
  @Input() searchSortBy: any;
  @Input() searchSortOrder: any;
  @Input() changeSearchSorting: Function;

  productListType = 'products';
  productListCurrentPage = 1;
  productListTotalPage = 1;
  productListPerPageLimit = 5;
  productPaginatedRecord = []

  moment = moment;

  overviewChartData = false;
  searchChartData = false;
  ageChartData = false;
  genderChartData = false;
  geoChartData = false;

  genderChartMapping
  ageChartMapping
  overChartMapping

  retailerId = 0;
  adwordsData = {};
  adwordsChartData = [];
  searchData = [];
  ageData = {};
  genderData = {};
  geoData = [];

  activeOverview = {
    name: 'campaignAds',
    label: 'Summary',
    color: '#44f218'
  }

  carouselOptions = {
    stagePadding: 50,
    loop: false,
    margin: 10,
    nav: true,
    dots: false,
    navText: ['<a role="button" class="controller next"><img src="assets/images/svgs/right-arrow-icon.svg" alt=""></a>', '<a role="button" class="controller next"><img src="assets/images/svgs/right-arrow-icon.svg" alt=""></a>'],
    responsive: {
      0: {
        items: 7
      },
    }
  }

  bigLoader = 'assets/loader_1.gif';
  smallLoader = 'assets/loader_1.gif';

  constructor(
    private userService: UserService,
    public helper: Helper
  ) {
    this.retailerId = this.userService.getRetailerDetails().Retailer_Rec_ID;
  }

  ngOnInit() {
  }

  ngOnChanges(changes: any) {
    if (changes.selectedGCampaign && changes.selectedGCampaign.currentValue == 0) {
      this.adwordsData = {};
      this.adwordsChartData = [];
      this.searchData = [];
      this.ageData = {};
      this.genderData = {};
      this.geoData = [];
    }
    if (changes.googleAdsSearchReport) {
      this.googleAdsSearchReport = changes.googleAdsSearchReport.currentValue;
      this.initSearchChart();
    }
    if (changes.googleAdsAccountReport) {
      this.googleAdsAccountReport = changes.googleAdsAccountReport.currentValue;
      this.initAccountChart();
    }
    if (changes.googleAdsAgeReport) {
      this.googleAdsAgeReport = changes.googleAdsAgeReport.currentValue;
      this.initAgeChart();
    }
    if (changes.googleAdsGenderReport) {
      this.googleAdsGenderReport = changes.googleAdsGenderReport.currentValue;
      this.initGenderChart();
    }
    if (changes.googleAdsGeoReport) {
      this.googleAdsGeoReport = changes.googleAdsGeoReport.currentValue;
      this.initGeoChart();
    }
    if (changes.googleAdsProductReport) {
      this.productPaginatedRecord = [];
      this.googleAdsProductReport = changes.googleAdsProductReport.currentValue;
      if(this.googleAdsProductReport['products'] && this.googleAdsProductReport['products'].length){
        this.productPaginatedRecord = this.helper.arrayObjectSort(this.googleAdsProductReport['products'],'impressions','desc')
      }
      if(this.googleAdsProductReport['brands'] && this.googleAdsProductReport['brands'].length){
        this.productPaginatedRecord = this.helper.arrayObjectSort(this.googleAdsProductReport['brands'],'impressions', 'desc')
      }
      this.initialiseProductListPagination(this.googleAdsProductReport)
    }
    if (changes.googleAdsStatsReport) {
      this.googleAdsStatsReport = changes.googleAdsStatsReport.currentValue;
    }

    if (changes.googleAdsSearchLoading) {
      this.googleAdsSearchLoading = changes.googleAdsSearchLoading.currentValue;
    }
    if (changes.googleAdsGeoLoading) {
      this.googleAdsGeoLoading = changes.googleAdsGeoLoading.currentValue;
    }
    if (changes.googleAdsAccountLoading) {
      if(this.overChartMapping && this.googleAdsAccountLoading) this.overChartMapping.destroy()
      this.googleAdsAccountLoading = changes.googleAdsAccountLoading.currentValue;
    }
    if (changes.googleAdsAgeLoading) {
      if(this.ageChartMapping && this.googleAdsAgeLoading) this.ageChartMapping.destroy()
      this.googleAdsAgeLoading = changes.googleAdsAgeLoading.currentValue;
    }
    if (changes.googleAdsGenderLoading) {
      if(this.genderChartMapping && this.googleAdsGenderLoading) this.genderChartMapping.destroy()
      this.googleAdsGenderLoading = changes.googleAdsGenderLoading.currentValue;
    }
  }

  initAccountChart() {
    if (this.googleAdsAccountReport && this.googleAdsAccountReport['result']) {
      this.adwordsData = this.googleAdsAccountReport['result']['total'];
      this.adwordsChartData = this.helper.multiSort(this.googleAdsAccountReport['result']['detail'], { Day: 'asc' });;
    }
    if (this.adwordsData && this.adwordsData['Clicks'] && this.adwordsData['Clicks'] == 'Total') {
      if (this.adwordsChartData && this.adwordsChartData.length) {
        let clicks = 0;
        this.adwordsChartData.forEach(data => {
          if (data['Day'] !== ' --') {
            clicks = clicks + data['Clicks'];
          }
        })
        this.adwordsData['Clicks'] = clicks;
      }
      else this.adwordsData['Clicks'] = 0;
    }
    this.overviewChart();
  }

  initSearchChart() {
    if (this.googleAdsSearchReport && this.googleAdsSearchReport['result']) {
      const searchData = this.googleAdsSearchReport['result'];
      let processedData = {};
      if (searchData && searchData.length) {
        searchData.forEach(search => {
          if (search['query'] !== ' --') {
            if (processedData[search['query']]) {           
              processedData[search['query']].clicks = processedData[search['query']].clicks + search.clicks
              processedData[search['query']].impressions = processedData[search['query']].impressions + search.impressions
              processedData[search['query']].cost = processedData[search['query']].cost + search.cost
              processedData[search['query']].totalRecords = processedData[search['query']].totalRecords + 1;
            }else {
              search['totalRecords'] = 1
              processedData[search['query']] = search;
            }
          }
        });
      }
      this.searchData = this.helper.multiSort(Object.values(processedData), { impressions: 'desc' });
      this.searchChartData = this.searchData.length ? true : false;
    }
  }

  initAgeChart() {
    if (this.googleAdsAgeReport && this.googleAdsAgeReport['result']) {
      this.ageData = this.googleAdsAgeReport['result'];
    }
    this.demographicAgeChart();
  }

  initGeoChart() {
    if (this.googleAdsGeoReport && this.googleAdsGeoReport['result']) {
      let geoDetails = this.googleAdsGeoReport['result'];
      if (geoDetails && geoDetails['locations'] && geoDetails['locations'].length) {
        let _return = {};
        geoDetails['locations'].forEach((location) => {
          if (geoDetails['locationName'] && geoDetails['locationName'][location.City]) {
            if (_return[location.City]) {
              _return[location.City] = {
                impressions: _return[location.City].impressions + location.impressions,
                clicks: _return[location.City].clicks + location.clicks,
                cost: _return[location.City].cost + location.cost,
                locationName: geoDetails['locationName'][location.City]
              }
            }
            else {
              _return[location.City] = {
                impressions: location.impressions,
                clicks: location.clicks,
                cost: location.cost,
                locationName: geoDetails['locationName'][location.City]
              }
            }
          }
        })
        const geoArray = this.helper.multiSort(Object.values(_return), { impressions: 'desc' });
        this.geoData = geoArray.slice(0, 10);
      }
      else this.geoData = [];

      this.geoChartData = this.geoData.length ? true : false;
    }
  }

  initGenderChart() {
    if (this.googleAdsGenderReport && this.googleAdsGenderReport['result']) {
      this.genderData = this.googleAdsGenderReport['result'];
    }
    this.demographicChart();
  }

  changeOverviewChart(name, label, color) {
    this.activeOverview = { name, label, color };
    this.overviewChart();
  }

  getAdsChartData() {
    let chartData = [];
    if (this.googleAdsAccountReport && this.googleAdsAccountReport['result'] && this.googleAdsAccountReport['result']['list'].length) {
      let impressionTupples = []
      let clicksTupples = []
      let ctrTupples = []
      let avgCpcTupples = []
      let impressionShareTupples = []
      let costTupples = []
      this.googleAdsAccountReport['result']['list'].forEach((stats, index) => {
        impressionTupples.push({
          y: stats['impressions'],
          label: moment(new Date(stats.date)).utc(false).format("D MMM")
        })
        clicksTupples.push({
          y: stats['clicks'],
          label: moment(new Date(stats.date)).utc(false).format("D MMM")
        })
        ctrTupples.push({
          y: stats['ctr'],
          label: moment(new Date(stats.date)).utc(false).format("D MMM")
        })
        avgCpcTupples.push({
          y: stats['averageCpc'],
          label: moment(new Date(stats.date)).utc(false).format("D MMM")
        })
        impressionShareTupples.push({
          y: stats['searchImpressionShare'],
          label: moment(new Date(stats.date)).utc(false).format("D MMM")
        })
        costTupples.push({
          y: '$'+stats['cost'],
          label: moment(new Date(stats.date)).utc(false).format("D MMM")
        })
      })
      let data = [
        {
          type: "line",
          showInLegend: false,
          name: 'Impressions',
          color: '#ea4435',
          xValueFormatString: "MMM DD, YYYY",
          dataPoints: impressionTupples
        },
        {
          type: "line",
          showInLegend: false,
          name: 'Clicks',
          color: '#4284f3',
          xValueFormatString: "MMM DD, YYYY",
          dataPoints: clicksTupples
        },
        {
          type: "line",
          showInLegend: false,
          name: 'CTR',
          color: '#fabd04',
          xValueFormatString: "MMM DD, YYYY",
          dataPoints: ctrTupples
        },
        {
          type: "line",
          showInLegend: false,
          name: 'Average CPC',
          color: '#d370ec',
          xValueFormatString: "MMM DD, YYYY",
          dataPoints: avgCpcTupples
        },
        {
          type: "line",
          showInLegend: false,
          name: 'Search Impression Share',
          color: '#96c0ff',
          xValueFormatString: "MMM DD, YYYY",
          dataPoints: impressionShareTupples
        },
        {
          type: "line",
          showInLegend: false,
          name: 'Cost',
          color: '#44f218',
          xValueFormatString: "MMM DD, YYYY",
          dataPoints: costTupples
        }
      ]
      chartData = data;
    }
    return chartData;
  }

  getCampaignAdChartDataByType() {
    let chartData = [];
    if (this.googleAdsAccountReport && this.googleAdsAccountReport['result'] && this.googleAdsAccountReport['result']['list'].length) {
      let data = {
        type: "line",
        showInLegend: false,
        name: this.activeOverview.label,
        color: this.activeOverview.color,
        xValueFormatString: "MMM DD, YYYY",
        dataPoints: []
      }
      let tupples = []
      this.googleAdsAccountReport['result']['list'].forEach((stats, index) => {
        let value = stats[this.activeOverview.name];
        let tuple = {
          y: (this.activeOverview.label == 'cost') ? '$'+value : value,
          label: moment(new Date(stats.date)).utc(false).format("D MMM")
        }
        tupples.push(tuple);
      })
      data.dataPoints = tupples;
      chartData.push(data);
    }
    return chartData;
  }

  overviewChart() {
    let chartData = [];
    if (this.activeOverview.name == 'campaignAds') chartData = this.getAdsChartData();
    else chartData = this.getCampaignAdChartDataByType();
    this.overviewChartData = chartData.length ? true : false;
    let chart = new CanvasJS.Chart("overviewChartContainer", {
      width: 1000,
      animationEnabled: true,
      theme: "light2",
      title: {
        text: ""
      },
      axisX: {
        valueFormatString: "D MMM"
      },
      axisY: {
        lineThickness: 1,
        gridThickness: 1
      },
      toolTip: {
        shared: true
      },
      legend: {  
        cursor: "pointer",
        itemclick: function (e: any) {
          if (typeof (e.dataSeries.visible) === "undefined" || e.dataSeries.visible) {
            e.dataSeries.visible = false;
          } else {
            e.dataSeries.visible = true;
          } 
          e.chart.render();
        }
      },
      options: {
        responsive: false,
        maintainAspectRatio: true,
        showScale: false
      },
      data: chartData
    });
    this.overChartMapping = chart
    chart.render();
  }

  demographicChart() {
    let chartData = [];
    if (this.genderData && Object.keys(this.genderData).length) {
      Object.keys(this.genderData).forEach((gender) => {
        if (gender !== ' --') {
          chartData.push({
            name: gender,
            y: this.genderData[gender].impressions,
            clicks: this.genderData[gender].clicks,
            cost: this.genderData[gender].cost
          })
        }
      })
    }

    this.genderChartData = chartData.length ? true : false;

    let chart = new CanvasJS.Chart("demographicChartContainer", {
      theme: "light2",
      animationEnabled: true,
      exportEnabled: true,
      title: {
        text: ""
      },
      data: [{
        type: "pie",
        showInLegend: true,
        toolTipContent: "<b>{name}</b>:(#percent%)<br><b>Impressions</b>: {y}<br><b>Clicks: </b>:{clicks}",
        indexLabel: "{name} - #percent%",
        dataPoints: chartData
      }]
    });
	this.genderChartMapping = chart
    chart.render();
  }

  demographicAgeChart() {
    let chartData = [];
    if (this.ageData && Object.keys(this.ageData).length) {
      Object.keys(this.ageData).sort().reverse().forEach((age) => {
        if (age !== ' --') {
          let ageLabel = age.replace('AGE_RANGE_','')
          ageLabel = ageLabel.replace('_',' to ')
          chartData.push({
            label: ageLabel,
            y: this.ageData[age].impressions,
            clicks: this.ageData[age].clicks,
            cost: this.ageData[age].cost
          })
        }
      })
    }

    this.ageChartData = chartData.length ? true : false;

    let chart = new CanvasJS.Chart("demographicAgeChartContainer", {
      animationEnabled: true,
      title: {
        text: ""
      },
      axisX: {
        interval: 1,
        lineThickness: 0,
        gridThickness: 0
      },
      axisY: {
        lineThickness: 0,
        gridThickness: 0
      },
      data: [{
        type: "bar",
        toolTipContent: "<b>Impressions:</b> {y}<br><b>Clicks:</b> {clicks}",
        dataPoints: chartData
      }]
    });
    this.ageChartMapping = chart
    chart.render();
  }


  changeSorting(e) {
    let sorting = [];
    sorting[e.target.value] = 'desc';
    this.searchData = this.helper.multiSort(this.searchData, sorting);
  }

  changeProcutListingType(e) {
    this.productListType = e.target.value
    this.initialiseProductListPagination(this.googleAdsProductReport)
  }

  initialiseProductListPagination(data){
    this.productListCurrentPage = 1;
    this.productListTotalPage = 1;
    if (data[this.productListType] && data[this.productListType].length > 0) {  
      const pageCount = data[this.productListType].length / this.productListPerPageLimit;  
      const roundedPageCount = Math.floor(pageCount);  
      this.productListTotalPage = roundedPageCount < pageCount ? roundedPageCount + 1 : roundedPageCount;  
      this.productPaginatedRecord = data[this.productListType].slice(0, this.productListPerPageLimit);
    }  
  }

  productListChangePage(actionType){
    if(actionType == 'next'){
      this.productListCurrentPage = ((this.productListCurrentPage + 1) <= this.productListTotalPage) ? this.productListCurrentPage + 1 : this.productListCurrentPage;
    }else{
      this.productListCurrentPage = this.productListCurrentPage > 1 ? this.productListCurrentPage - 1 : this.productListCurrentPage;
    }
    let starting = 0;
    let ending = 0; 
    if(this.productListCurrentPage == 1){
      ending =  this.productListCurrentPage * this.productListPerPageLimit
    }else{
      starting = (this.productListCurrentPage - 1) * this.productListPerPageLimit
      ending = this.productListCurrentPage * this.productListPerPageLimit
    }
    this.productPaginatedRecord = this.googleAdsProductReport[this.productListType].slice(starting, ending);
  }
}