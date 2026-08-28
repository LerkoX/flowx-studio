# FlowX 节点 UI 组件模板（module 模式）

FlowX Studio 支持在画布节点中内嵌节点包自带的自定义 UI 组件。本目录是一个基于
React + Vite 的开发模板，构建产物为**单文件 ESM bundle**，可直接作为节点包
`flowx.json` 的 `ui.entry`。

## 快速开始

```bash
npm install
npm run build        # 产出 dist/node-widget.js
```

把 `dist/node-widget.js` 拷贝到节点包目录（如 `ui/node-widget.js`），并在
`flowx.json` 中声明：

```json
{
  "ui": {
    "entry": "ui/node-widget.js",
    "width": 280,
    "height": 140,
    "collapsed": false,
    "apiVersion": 1
  }
}
```

然后 `flowx-studio node import --type folder --path <节点包目录>` 导入即可。
在「节点管理 → 测试」面板可立即看到 UI 预览。

## 组件契约（apiVersion 1）

入口默认导出一个挂载函数（见 `src/contract.ts` 与 `src/index.tsx`）：

```ts
export default function mount(el: HTMLElement, props: NodeWidgetProps): NodeWidgetHandle
```

- `mount(el, props)`：把 UI 挂载到 `el`，返回 `{ update, unmount }`
- `update(props)`：节点数据变化（状态流转、输出更新、流水线执行 metadata 推送）时调用
- `unmount()`：节点卸载时调用

`props` 为**只读**：包含节点实例 ID、节点包名、执行状态、入参、输出，以及流水线
执行实例的实时 metadata（无运行实例时 `execution` 为 `null`）。组件无法回调
Studio，也不会获得认证信息。

## 说明

- **React 等依赖直接打入 bundle**，与 Studio 无共享依赖，也没有特殊构建约束
- 可以不用 React：任何框架（或原生 JS）均可，只要最终单文件 bundle 默认导出
  `mount` 函数；IIFE/UMD 产物则可调用 `window.FlowXNodeWidget.define(mount)` 注册
- bundle 大小上限 **10MB**
- 免构建示例见 `tests/e2e/testdata/ui-demo-node/ui/node-widget.js`（原生 DOM 版）
