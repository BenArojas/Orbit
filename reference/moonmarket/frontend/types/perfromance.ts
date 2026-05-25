
export interface NAVSeries {
    dates: string[];
    navs: number[];
  }
  export interface ReturnSeries {
    dates: string[];
    returns: number[];
  }
  
  export interface Performance {
    nav: NAVSeries;
    cps: ReturnSeries;
    tpps: ReturnSeries;
  }