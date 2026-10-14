import { type IMThemeVariables, css, type SerializedStyles } from 'jimu-core'
import { styleUtils } from 'jimu-ui'
import type { Style } from '../../config'

export function getStyle (theme: IMThemeVariables, style: Style): SerializedStyles {
  const fillStyleCss = styleUtils.toCSSStyle({ background: style.background }) as any
  delete fillStyleCss.backgroundColor
  const fontColor = style.fontColor || theme.sys.color.surface.paperText
  const root = style.background?.color || 'transparent'
  const cardRoot = style.background?.color || theme.sys.color.surface.paper

  return css`
    ${style.background?.color ? 'background: transparent;' : '' }
    overflow: auto;
    .widget-legend {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 32px;
      min-width: 0;
      background-color: ${root};
      position: relative;
      ${fillStyleCss}
      --calcite-color-text-2: ${fontColor};

      .legend-container {
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
      }

      arcgis-legend {
        width: 100%;
        height: 100%;
        display: block;
        min-height: 0;
        color: ${fontColor};
        --calcite-color-text-1: ${fontColor};
        --calcite-color-text-2: ${fontColor};
        --calcite-color-foreground-1: ${cardRoot};
        --calcite-carousel-pagination-icon-color: var(--sys-color-surface-paper-text);
        --calcite-carousel-pagination-icon-color-selected: var(--sys-color-action-selected);
        // Use the paper's bg color, set the legend's bg color to transparent
        --calcite-color-foreground-1: transparent;

        arcgis-legend-classic-view h3.esri-widget__heading {
          display: none !important;
        }
      }
    }
  `
}
