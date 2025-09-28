# LiteGraph.js 关键知识点

## 1. 核心架构

### 基础类
- **LGraph**: 图形对象，管理整个节点图
  - 管理节点、连接、执行顺序
  - 提供序列化/反序列化功能
  - 处理图形的生命周期（start/stop）
  
- **LGraphCanvas**: 画布渲染对象
  - 处理图形的可视化渲染
  - 管理用户交互（拖拽、选择、连接）
  - 提供缩放、平移等视图控制

- **LGraphNode**: 节点基类
  - 所有自定义节点的父类
  - 管理输入/输出端口
  - 处理数据流和执行逻辑

## 2. 基础初始化模式

```javascript
// 创建图形和画布
var graph = new LGraph();
var canvas = new LGraphCanvas("#mycanvas", graph);

// 创建并添加节点
var node = LiteGraph.createNode("节点类型");
node.pos = [x, y];  // 设置位置
graph.add(node);

// 连接节点
node1.connect(输出端口, node2, 输入端口);

// 启动图形执行
graph.start();
```

## 3. 自定义节点创建

### 方式一：构造函数方式
```javascript
function MyCustomNode() {
    // 添加输入端口
    this.addInput("输入名", "数据类型");
    // 添加输出端口
    this.addOutput("输出名", "数据类型");
    // 设置属性
    this.properties = { value: 默认值 };
}

// 设置节点属性
MyCustomNode.title = "节点标题";
MyCustomNode.size = [宽度, 高度];

// 实现执行逻辑
MyCustomNode.prototype.onExecute = function() {
    var input_data = this.getInputData(端口索引);
    // 处理数据...
    this.setOutputData(端口索引, 输出数据);
}

// 注册节点类型
LiteGraph.registerNodeType("分类/节点名", MyCustomNode);
```

### 方式二：ES6类方式
```javascript
class MyCustomNode extends LiteGraph.LGraphNode {
    constructor() {
        super();
        this.addInput("input", "number");
        this.addOutput("output", "number");
        this.properties = { value: 10 };
    }
    
    onExecute() {
        var input = this.getInputData(0);
        this.setOutputData(0, input * 2);
    }
}

MyCustomNode.title = "My Node";
LiteGraph.registerNodeType("custom/my_node", MyCustomNode);
```

## 4. 数据类型系统

### 支持的数据类型
- `"*"` : 通用类型，接受任何数据
- `"number"` : 数字
- `"string"` : 字符串  
- `"boolean"` : 布尔值
- `"array"` : 数组
- `"object"` : 对象
- `"vec2"` : 二维向量 [x, y]
- `"vec3"` : 三维向量 [x, y, z]
- `"vec4"` : 四维向量 [x, y, z, w]
- `"image"` : 图片数据
- `"Texture"` : 纹理数据

## 5. 节点端口管理

### 输入端口操作
```javascript
// 添加输入
this.addInput("名称", "类型");
// 获取输入数据
var data = this.getInputData(索引);
// 按名称获取输入数据
var data = this.getInputDataByName("名称");
// 检查是否连接
var connected = this.isInputConnected(索引);
// 断开输入连接
this.disconnectInput(索引);
```

### 输出端口操作  
```javascript
// 添加输出
this.addOutput("名称", "类型");
// 设置输出数据
this.setOutputData(索引, 数据);
// 检查是否连接
var connected = this.isOutputConnected(索引);
// 断开输出连接
this.disconnectOutput(索引);
```

## 6. 节点生命周期回调

### 核心回调函数
- `onExecute()`: 节点执行时调用，处理主要逻辑
- `onAdded(graph)`: 节点被添加到图形时调用
- `onRemoved()`: 节点被移除时调用
- `onConnectionsChange(type, slot, connected, link_info)`: 连接状态改变时调用
- `onPropertyChanged(name, value)`: 属性改变时调用
- `onConfigure(data)`: 节点配置时调用
- `onSerialize(data)`: 序列化时调用

### 绘制相关回调
- `onDrawBackground(ctx)`: 绘制节点背景
- `onDrawForeground(ctx)`: 绘制节点前景
- `onMouseDown(event, local_pos, graphcanvas)`: 鼠标按下事件
- `onMouseUp(event, local_pos, graphcanvas)`: 鼠标释放事件
- `onMouseMove(event, local_pos, graphcanvas)`: 鼠标移动事件

## 7. 图形管理

### 图形操作
```javascript
// 添加节点
graph.add(node);
// 移除节点
graph.remove(node);
// 清空图形
graph.clear();
// 启动执行
graph.start();
// 停止执行
graph.stop();
// 执行一步
graph.runStep();
```

### 序列化
```javascript
// 序列化图形
var data = graph.serialize();
// 反序列化图形
graph.configure(data);
```

## 8. 画布交互

### 常用快捷键
- `Space + Drag`: 平移画布
- `Ctrl/Shift + Click`: 多选节点
- `Ctrl + A`: 全选
- `Ctrl + C / Ctrl + V`: 复制粘贴
- `Delete`: 删除选中节点

### 画布配置
```javascript
// 禁用交互
canvas.allow_interaction = false;
// 设置背景色
canvas.background_color = "#222";
// 显示网格
canvas.render_grid = true;
```

## 9. 内置节点类型

### 基础节点类型
- `"basic/const"`: 常量节点
- `"basic/watch"`: 监视器节点
- `"basic/time"`: 时间节点
- `"basic/console"`: 控制台输出节点

## 10. 高级功能

### 小部件 (Widgets)
```javascript
// 添加数字输入小部件
this.addWidget("number", "名称", 默认值, 回调函数);
// 添加滑块小部件
this.addWidget("slider", "名称", 默认值, 回调函数, {min: 0, max: 100});
// 添加下拉菜单小部件
this.addWidget("combo", "名称", 默认值, 回调函数, {values: ["选项1", "选项2"]});
```

### 触发器系统
```javascript
// 设置为触发模式
this.mode = LiteGraph.ON_TRIGGER;
// 触发执行
this.triggerSlot(输出端口索引);
```

## 11. 错误处理

### 异常捕获
```javascript
// 开启异常捕获模式
LiteGraph.catch_exceptions = true;
```

### 调试模式
```javascript
// 开启调试模式
LiteGraph.debug = true;
```

## 12. 性能优化

### 执行模式
- `LiteGraph.ALWAYS`: 总是执行
- `LiteGraph.ON_EVENT`: 事件触发执行
- `LiteGraph.NEVER`: 从不执行
- `LiteGraph.ON_TRIGGER`: 触发器模式

### 限制
- 最大节点数: 1000 (LiteGraph.MAX_NUMBER_OF_NODES)
- 建议在大型图形中合理使用执行模式来优化性能

## 13. 在SillyTavern中的应用考虑

### 集成要点
1. **模块化**: 每个工作流组件作为独立节点
2. **数据流**: 利用LiteGraph的数据流特性传递聊天数据
3. **序列化**: 支持工作流的保存和加载
4. **扩展性**: 通过注册自定义节点类型支持插件扩展
5. **用户体验**: 提供直观的可视化编辑界面

### 建议的节点类型
- 输入节点：用户消息、系统提示词
- 处理节点：文本处理、API调用、条件判断
- 输出节点：消息发送、日志记录
- 控制节点：循环、分支、延时

### 性能考虑
- 异步处理长时间运行的任务
- 合理使用触发器模式避免不必要的计算
- 提供执行状态的可视化反馈