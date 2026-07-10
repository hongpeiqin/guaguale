# 莫比乌斯粒子环

一个无需构建步骤的 Three.js 3D 粒子特效：粒子沿莫比乌斯带上的闭合轨迹持续流动，并带有透明曲面、单边界辉光、彗星节点、星空和 Bloom 后期效果。

## 功能

- GPU 顶点着色器计算粒子位置，5200 个主粒子 + 1100 个空间尘埃
- 粒子轨迹基于莫比乌斯带参数方程，形成真正闭合的 `2π` 路径
- 单条边界轨迹用 `4π` 完整闭合，展示莫比乌斯带只有一条边的性质
- 鼠标拖拽旋转、滚轮缩放、自动旋转
- 可调流速、辉光强度、暂停/继续、复位相机
- 响应式布局，支持桌面端与移动端
- 不需要 npm、打包器或后端

## 本地运行

ES Module 不能稳定地通过 `file://` 加载，因此请在目录中启动一个静态服务器：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

也可以使用：

```bash
npx serve .
```

## 项目结构

```text
mobius-particle-demo/
├── index.html
├── style.css
├── src/
│   └── main.js
└── README.md
```

## 数学参数

莫比乌斯带使用下列参数方程：

```text
x = (R + v cos(u/2)) cos(u)
y = v sin(u/2)
z = (R + v cos(u/2)) sin(u)
```

其中 `u ∈ [0, 2π]`，`v ∈ [-w, w]`。

主粒子轨迹使用一个反周期横向参数：

```text
v(u) = 0.62w cos(u/2)
```

由于 `v(u + 2π) = -v(u)`，它会在莫比乌斯带的边界识别关系下闭合，粒子不会在接缝处跳跃。

## 自定义

核心参数集中在 `src/main.js` 顶部的 `CONFIG`：

```js
const CONFIG = Object.freeze({
  radius: 3.25,
  halfWidth: 1.08,
  particleCount: 5200,
  dustCount: 1100,
  packetCount: 18,
  baseSpeed: 0.092,
});
```

Three.js 使用固定版本 `0.185.1`，通过 jsDelivr CDN 加载，避免未来版本更新造成兼容性变化。
