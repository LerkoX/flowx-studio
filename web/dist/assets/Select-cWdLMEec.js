import{j as t,A as h,m as w}from"./framer-motion-DEL-rn3i.js";import{d as l}from"./react-vendor-DH9BI_aq.js";import{d}from"./index-CD8UVVtX.js";/**
 * @license lucide-react v0.436.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=d("Check",[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]);/**
 * @license lucide-react v0.436.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b=d("ChevronDown",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);function k({value:o,onChange:m,options:c,className:x="",triggerClassName:f}){const[n,s]=l.useState(!1),a=l.useRef(null);l.useEffect(()=>{if(!n)return;const e=i=>{a.current&&!a.current.contains(i.target)&&s(!1)},u=i=>{i.key==="Escape"&&s(!1)};return document.addEventListener("mousedown",e),document.addEventListener("keydown",u),()=>{document.removeEventListener("mousedown",e),document.removeEventListener("keydown",u)}},[n]);const r=c.find(e=>e.value===o);return t.jsxs("div",{ref:a,className:`relative ${x}`,children:[t.jsxs("button",{type:"button",onClick:()=>s(!n),className:`w-full flex items-center justify-between gap-2
                  bg-white/5 border border-white/10
                  hover:bg-white/[0.07] focus:outline-none focus:border-white/20
                  transition-all cursor-pointer
                  ${f??"px-3 py-2 rounded-lg text-xs text-white/80"}`,children:[t.jsx("span",{className:"truncate",children:r==null?void 0:r.label}),t.jsx(b,{size:12,className:`text-white/30 flex-shrink-0 transition-transform ${n?"rotate-180":""}`})]}),t.jsx(h,{children:n&&t.jsx(w.div,{initial:{opacity:0,scale:.95,y:-4},animate:{opacity:1,scale:1,y:0},exit:{opacity:0,scale:.95,y:-4},transition:{duration:.12},className:`absolute left-0 top-full mt-1 z-50 min-w-full max-h-60 overflow-y-auto
                     bg-panel/95 backdrop-blur-2xl border border-white/10 rounded-xl
                     shadow-xl shadow-black/30 py-1`,children:c.map(e=>t.jsxs("button",{type:"button",onClick:()=>{m(e.value),s(!1)},className:`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors
                  ${e.value===o?"text-indigo-300 bg-indigo-500/10":"text-white/60 hover:bg-white/5 hover:text-white"}`,children:[t.jsx("span",{className:"truncate",children:e.label}),e.value===o&&t.jsx(p,{size:12,className:"flex-shrink-0"})]},e.value))})})]})}export{p as C,k as S,b as a};
