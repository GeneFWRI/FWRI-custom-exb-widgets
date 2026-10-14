import type { ImmutableObject } from 'seamless-immutable'
import type { MeasurementsUnitsInfo, MeasurementsPropsInfo, DrawOptionsInfo } from 'jimu-ui/advanced/map'


export enum Arrangement {
  Panel = 'Panel',
  Toolbar = 'Toolbar'
}

export enum DrawMode {
  Continuous = 'continuous',
  Update = 'update'
}

export enum DrawingTool {
  Polygon = 'polygon',
  Rectangle = 'rectangle',
  Circle = 'circle',
  Text = 'text',
  FreehandPolygon = "freehandPolygon"
}

// for groupLayer listMode
export enum LayerListMode {
  Show = 'show',
  Hide = 'hide'
}

export interface Config {
  isDisplayCanvasLayer: boolean
  arrangement: Arrangement
  drawMode: DrawMode
  drawingTools: DrawingTool[]
  layerListMode: LayerListMode
  measurementsInfo: MeasurementsPropsInfo
  measurementsUnitsInfos: MeasurementsUnitsInfo[]
  drawOptions: DrawOptionsInfo
  //isEnableAdvancedSetting: boolean
}

export type IMConfig = ImmutableObject<Config>
