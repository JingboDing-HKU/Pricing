# 参数化保险精算运营台 Demo

这个 demo 把 `parametric_insurance_formula_rendered_clean.pdf` 中的框架拆成四个可交互模块：

- 定价引擎：泊松触发概率、分段赔付函数、纯风险保费和毛保费。
- 资本与再保：组合损失模拟、99.5% VaR / TVaR、自留层、再保层和 Cat Bond 层。
- IFRS 17：短期合同的 PAA、LRC 摊销、保险收入与触发赔付确认。
- ALM：快速赔付资金池、短久期资产配置、稳定币赔付池和 RBC 资本占用视角。

直接打开 `index.html` 即可运行，不需要后端服务。
