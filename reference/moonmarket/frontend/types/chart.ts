import {
    Time
} from "lightweight-charts";

export type ChartDataBars = {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  
  export type ChartDataPoint = {
    time: Time;
    value: number
  }