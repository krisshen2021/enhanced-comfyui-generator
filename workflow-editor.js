import { executeWorkflowInComfyUI } from './workflow-executor.js';

// ComfyUI Workflow 编辑器核心功能
// 独立的 workflow 编辑功能模块

// 导入必要的依赖 (SillyTavern 全局变量)
// extension_settings, saveSettingsDebounced, toastr 等在 SillyTavern 中已定义

// 全局变量声明
let lgraphInstance = null;
let canvasInstance = null;
let originalWorkflowJson = null;

// 节点样式配置
const nodeStyles = {
    global: {
        nodeTitleColor: "#DDD",
        nodeTitleHeight: 30,
        nodeDefaultColor: "#00344dff",      // 边框颜色
        nodeDefaultBgColor: "#454545ff",    // 节点主体背景色
    },
    specialized: {
        loadImage: {
            color: "#8a5d08ff",      // 标题栏背景色
            bgcolor: "#937a54ff",    // 节点主体背景色
        }
    }
};

// 防抖函数
function debounce(func, wait) {
    let timeout;
    const debounced = function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
    // 添加一个立即执行的选项，用于首次调用
    debounced.immediate = function(...args) {
        clearTimeout(timeout);
        func.apply(this, args);
    };
    return debounced;
}

// 从主模块传递的全局变量引用
let extensionSettingsRef = null;
let saveSettingsDebounced = null;

// ComfyUI API 配置
let comfyUIApiBase = 'http://127.0.0.1:8188'; // 默认 ComfyUI 地址
let availableModels = {
    checkpoints: [],
    vaes: [],
    samplers: [],
    schedulers: []
};

// 从 ComfyUI API 直接获取可用模型和参数列表
async function fetchComfyUILists() {
    try {
        console.log('[workflow-editor] Fetching ComfyUI models and parameters directly from API...');
        console.log('[workflow-editor] ComfyUI URL:', comfyUIApiBase);

        // 直接调用 ComfyUI 的 /object_info 端点
        const objectInfoUrl = `${comfyUIApiBase}/object_info`;
        console.log('[workflow-editor] Requesting:', objectInfoUrl);

        const response = await fetch(objectInfoUrl, {
            method: 'GET',
            mode: 'cors', // 明确指定 CORS 模式
            headers: {
                'Accept': 'application/json',
            },
        });

        console.log('[DEBUG] Raw response status:', response.status);
        console.log('[DEBUG] Raw response statusText:', response.statusText);
        console.log('[DEBUG] Raw response headers:', Object.fromEntries(response.headers.entries()));

        const clonedResponse = response.clone();
        const responseBodyText = await clonedResponse.text();
        console.log('[DEBUG] Raw response body text:', responseBodyText);

        console.log('[workflow-editor] Response status:', response.status, response.statusText);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const objectInfo = await response.json();
        console.log('[workflow-editor] ComfyUI object info received:', objectInfo);

        // 解析 CheckpointLoaderSimple 节点来获取检查点列表
        if (objectInfo.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]) {
            availableModels.checkpoints = objectInfo.CheckpointLoaderSimple.input.required.ckpt_name[0];
            console.log('[workflow-editor] Found checkpoints:', availableModels.checkpoints.length);
        }

        // 解析 VAELoader 节点来获取 VAE 列表
        if (objectInfo.VAELoader?.input?.required?.vae_name?.[0]) {
            availableModels.vaes = objectInfo.VAELoader.input.required.vae_name[0];
            console.log('[workflow-editor] Found VAEs:', availableModels.vaes.length);
        }

        // 解析 KSampler 节点来获取采样器和调度器列表
        if (objectInfo.KSampler?.input?.required) {
            if (objectInfo.KSampler.input.required.sampler_name?.[0]) {
                availableModels.samplers = objectInfo.KSampler.input.required.sampler_name[0];
                console.log('[workflow-editor] Found samplers:', availableModels.samplers.length);
            }

            if (objectInfo.KSampler.input.required.scheduler?.[0]) {
                availableModels.schedulers = objectInfo.KSampler.input.required.scheduler[0];
                console.log('[workflow-editor] Found schedulers:', availableModels.schedulers.length);
            }
        }

        console.log('[workflow-editor] Successfully fetched ComfyUI data directly');
        return true;

    } catch (error) {
        console.error('[workflow-editor] Error fetching ComfyUI lists directly:', error);

        // 显示更详细的错误信息和解决方案
        if (error.message.includes('NetworkError') || error.message.includes('CORS')) {
            console.warn('[workflow-editor] CORS 错误解决方案：');
            console.warn('[workflow-editor] 1. 在 ComfyUI 启动时添加参数：python main.py --enable-cors-header');
            console.warn('[workflow-editor] 2. 或者使用：python main.py --listen --enable-cors-header');
            console.warn('[workflow-editor] 3. 确保 ComfyUI 版本支持 CORS（较新版本）');
        } else if (error.message.includes('403')) {
            console.warn('[workflow-editor] ComfyUI 返回 403 错误，可能的原因：');
            console.warn('[workflow-editor] 1. 需要启用 CORS：--enable-cors-header');
            console.warn('[workflow-editor] 2. 检查 ComfyUI 版本和配置');
        } else {
            console.warn('[workflow-editor] 其他错误，请检查：');
            console.warn('[workflow-editor] 1. ComfyUI 是否运行在：', comfyUIApiBase);
            console.warn('[workflow-editor] 2. 网络连接是否正常');
        }

        // 使用默认值作为后备
        availableModels = {
            checkpoints: ['v1-5-pruned-emaonly-fp16.safetensors'],
            vaes: ['vae-ft-mse-840000-ema-pruned.safetensors'],
            samplers: ['euler', 'euler_a', 'heun', 'dpm_2', 'dpm_2_a', 'lms', 'ddim', 'uni_pc'],
            schedulers: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple']
        };
        console.log('[workflow-editor] 使用默认模型列表，编辑器仍可正常工作');
        return false;
    }
}

// 设置 ComfyUI API 地址
function setComfyUIApiBase(url) {
    comfyUIApiBase = url;
    console.log('[workflow-editor] ComfyUI API base set to:', comfyUIApiBase);
}

// 初始化全局变量引用
function initializeGlobalReferences(extension_settings, saveSettingsDebounced_func) {
    extensionSettingsRef = extension_settings;
    saveSettingsDebounced = saveSettingsDebounced_func;
    console.log('[workflow-editor] Global references initialized');
}

// 通用 ComfyUI 节点类
function ComfyUINode() {
    // 基础属性
    this.comfyui_id = "";
    this.comfyui_class_type = "";
    this.comfyui_inputs = {};

    // 设置节点标题
    this.title = "ComfyUI 节点";

    // 初始化 properties 对象
    this.properties = {};
}

// 动态创建 widget 的方法
ComfyUINode.prototype.createWidget = function(paramName, paramType, defaultValue, options = {}) {
    // 先设置 properties 默认值
    this.properties[paramName] = defaultValue;

    let widget = null;  // 统一声明 widget 变量
    let precision = 2; // 默认浮点数精度

    switch(paramType) {
        case 'int':
            // 使用 number 类型，设置整数精度
            // 注意：LiteGraph内部会将step乘以0.1，所以要设置step为10才能每次增加1
            widget = this.addWidget("number", paramName, defaultValue, (v) => {
                const correctedValue = Math.floor(Number(v));
                this.properties[paramName] = correctedValue;
            }, {
                step: 10,  // LiteGraph会乘以0.1，所以10*0.1=1
                precision: 0,  // 显示为整数
                min: options.min,
                max: options.max
            });
            break;

        case 'float':
            // 根据官方文档，LiteGraph内部计算: w.value += delta * 0.1 * (w.options.step || 1)
            // 为了解决精度问题，我们让LiteGraph直接修改properties，并设置一个精度修正的回调
            precision = options.precision !== undefined ? options.precision : 1;
            widget = this.addWidget("number", paramName, defaultValue, (v) => {
                // 精度修正：将浮点数结果修正到指定精度
                const correctedValue = parseFloat(Number(v).toFixed(precision));
                this.properties[paramName] = correctedValue;
                // 同时修正widget的显示值
                widget.value = correctedValue;
            }, {
                step: options.step,  // 直接使用用户指定的step
                precision: precision,
                min: options.min,
                max: options.max
            });
            break;
        
        case 'text': // 为我们自定义的 text 类型添加明确的 case
        case 'string':
            // LiteGraph 中 string 和 text 是相同的，都弹出输入对话框
            widget = this.addWidget("text", paramName, defaultValue, (v) => {
                this.properties[paramName] = v;
            }, options);
            break;

        case 'textarea':
            // 多行文本输入widget，使用text类型+multiline选项
            widget = this.addWidget("text", paramName, defaultValue, (v) => {
                this.properties[paramName] = v;
            }, {
                multiline: true,
                ...options  // 合并其他选项
            });
            break;

        case 'boolean':
            widget = this.addWidget("toggle", paramName, defaultValue, (v) => {
                this.properties[paramName] = v;
            });
            break;

        case 'combo':
            const values = options.values || [];
            if (values.length === 0) {
                console.warn(`combo widget "${paramName}" 没有提供 values 选项`);
                return null;
            }
            widget = this.addWidget("combo", paramName, defaultValue, (v) => {
                this.properties[paramName] = v;
            }, { values: values });
            break;

        case 'slider':
            precision = options.precision !== undefined ? options.precision : 2;
            widget = this.addWidget("slider", paramName, defaultValue, (v) => {
                const correctedValue = parseFloat(Number(v).toFixed(precision));
                this.properties[paramName] = correctedValue;
                // 同时修正widget的显示值
                widget.value = correctedValue;
            }, {
                min: options.min !== undefined ? options.min : 0,
                max: options.max !== undefined ? options.max : 1,
                precision: precision
            });
            break;

        case 'button':
            widget = this.addWidget("button", paramName, defaultValue, (w, canvas, node, pos) => {
                if (options.callback) {
                    options.callback(w, canvas, node, pos);
                }
            });
            break;

        default:
            console.warn(`未知的widget类型: ${paramType}，使用默认text类型`);
            widget = this.addWidget("text", paramName, defaultValue, (v) => {
                this.properties[paramName] = v;
            });
            break;
    }

    return widget;
};

// 设置节点属性
ComfyUINode.title = "ComfyUI 节点";
ComfyUINode.size = [320, 280]; // 调整默认尺寸以适应更多widgets

// 注册自定义的 LoadImage 节点类型
function registerLoadImageNodeType() {
    function LoadImageNode() {
        // 基础属性
        this.comfyui_id = "";
        this.comfyui_class_type = "LoadImage";
        this.title = "Load Image";
        this.size = [320, 260]; // 初始大小

        // 应用特殊样式
        this.color = nodeStyles.specialized.loadImage.color;
        this.bgcolor = nodeStyles.specialized.loadImage.bgcolor;

        // 添加 widgets
        this.addWidget("text", "image", "", (value) => {
            // 当文本框内容改变时，可以触发一些逻辑，比如尝试加载新图片
        });
        this.addWidget("button", "上传图片", null, () => {
            this.uploadImage();
        });

        // 用于预览的图片对象
        this.previewImage = new Image();
        this.previewImage.onload = () => {
            // 图片加载成功后，强制重绘节点即可，不再调整节点大小
            this.setDirtyCanvas(true, true);
        };
    }

    // 图片上传逻辑
    LoadImageNode.prototype.uploadImage = function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('image', file);

            try {
                const response = await fetch(`${comfyUIApiBase}/upload/image`, {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                if (result.name) {
                    // 更新文本框的值
                    const imageNameWidget = this.widgets.find(w => w.name === "image");
                    if (imageNameWidget) {
                        imageNameWidget.value = result.name;
                    }

                    // 加载预览图
                    const imageUrl = `${comfyUIApiBase}/view?filename=${result.name}&subfolder=${result.subfolder || ''}&type=${result.type || 'input'}`;
                    this.previewImage.src = imageUrl;

                    toastr.success(`图片上传成功: ${result.name}`);
                }
            } catch (error) {
                console.error('图片上传失败:', error);
                toastr.error('图片上传失败，请检查 ComfyUI 连接和控制台日志。');
            }
        };
        input.click();
    };

    // 绘制背景预览图
    LoadImageNode.prototype.onDrawForeground = function(ctx) {
        if (this.previewImage && this.previewImage.complete && this.previewImage.width > 0) {
            // 计算等比缩放后的高度
            const nodeWidth = this.size[0];
            const scale = nodeWidth / this.previewImage.width;
            const imageHeight = this.previewImage.height * scale;

            // 预留出顶部 widgets 的空间
            const topMargin = 80;
            const paddingLeftRight = 10;
            const paddingBottom = 10;
            // 调整节点高度以适应图片
            this.size[1] = imageHeight + topMargin;
            ctx.save();
            // 绘制图片
            ctx.drawImage(this.previewImage, paddingLeftRight, topMargin, nodeWidth - paddingLeftRight * 2, imageHeight - paddingBottom);
            ctx.restore();
        }
    };

    LiteGraph.registerNodeType("comfyui/loadImage", LoadImageNode);
    console.log('[workflow-editor] Custom node type "comfyui/loadImage" registered.');
}


// 计算数字的小数位数（基于原始字符串）
function getDecimalPlaces(number) {
    const str = number.toString();
    if (str.indexOf('.') === -1) {
        return 0;
    }
    return str.split('.')[1].length;
}

// 根据参数值推断 widget 类型
function inferWidgetType(paramName, value, nodeClassType) {
    // 如果 value 是数组，说明是连接参数，不需要 widget
    if (Array.isArray(value)) {
        return null; // 连接参数
    }

    // 对于特殊的数字类型参数，强制使用 text widget，以便可以输入占位符
    const specialNumericParams = ['width', 'height', 'seed', 'noise_seed', 'steps', 'cfg', 'denoise'];
    if (specialNumericParams.includes(paramName)) {
        return { type: 'text' };
    }

    // 基于 JavaScript 类型推断
    if (typeof value === 'number') {
        // 统一使用 float widget 处理所有数值
        // 预留2位精度，确保用户有足够的编辑灵活性
        const currentPrecision = getDecimalPlaces(value);
        const precision = Math.max(2, currentPrecision); // 至少预留2位精度
        return { type: 'float', precision: precision };
    }

    if (typeof value === 'string') {
        return inferStringType(paramName, value, nodeClassType);
    }

    if (typeof value === 'boolean') {
        return { type: 'boolean' };
    }

    // 未知类型，默认为 string
    return { type: 'string' };
}

// 处理字符串类型参数，判断是否为下拉选择
function inferStringType(paramName, value, nodeClassType) {
    // 首先检查是否有从 API 获取的动态模型列表
    const dynamicComboParams = {
        'ckpt_name': availableModels.checkpoints,
        'vae_name': availableModels.vaes,
        'sampler_name': availableModels.samplers,
        'scheduler': availableModels.schedulers
    };

    // 如果动态列表存在且不为空，使用动态列表
    if (dynamicComboParams[paramName] && dynamicComboParams[paramName].length > 0) {
        return {
            type: 'combo',
            values: dynamicComboParams[paramName]
        };
    }

    // 回退到静态的已知参数列表（当 API 不可用时）
    const knownComboParams = {
        'sampler_name': ['euler', 'euler_a', 'heun', 'dpm_2', 'dpm_2_a', 'lms', 'ddim', 'uni_pc'],
        'scheduler': ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple'],
        'ckpt_name': ['v1-5-pruned-emaonly-fp16.safetensors'],
        'vae_name': ['vae-ft-mse-840000-ema-pruned.safetensors']
    };

    if (knownComboParams[paramName]) {
        return {
            type: 'combo',
            values: knownComboParams[paramName]
        };
    }

    // 检查是否适合使用多行文本输入（textarea）
    const textareaParams = [
        'text',           // CLIP Text Encode的text参数
        'positive',       // 正面提示词
        'negative',       // 负面提示词
        'prompt',         // 提示词
        'description',    // 描述
        'notes',          // 备注
        'comments'        // 评论
    ];

    // 如果参数名匹配或文本较长，使用textarea
    if (textareaParams.includes(paramName.toLowerCase()) ||
        (typeof value === 'string' && value.length > 50)) {
        return {
            type: 'textarea',
            multiline: true
        };
    }

    return { type: 'string' };
}

// ComfyUI workflow JSON 解码器
function decodeComfyUIWorkflow(workflowJson) {
    const decodedNodes = [];

    for (const [nodeId, nodeData] of Object.entries(workflowJson)) {
        // 优先使用 _meta.title，如果不存在则使用 class_type
        const nodeTitle = nodeData._meta?.title || nodeData.class_type;

        const decodedNode = {
            id: nodeId,
            class_type: nodeData.class_type,
            title: nodeTitle,
            widgets: [],
            connections: []
        };

        // 分析输入参数
        for (const [paramName, paramValue] of Object.entries(nodeData.inputs || {})) {
            const widgetInfo = inferWidgetType(paramName, paramValue, nodeData.class_type);

            if (widgetInfo) {
                // 创建 widget 配置
                decodedNode.widgets.push({
                    name: paramName,
                    type: widgetInfo.type,
                    value: paramValue,
                    options: widgetInfo
                });
            } else {
                // 记录连接信息（暂时不处理，留待后续实现）
                decodedNode.connections.push({
                    param: paramName,
                    sourceNode: paramValue[0],
                    sourceOutput: paramValue[1]
                });
            }
        }

        decodedNodes.push(decodedNode);
    }

    return decodedNodes;
}

// 将解码后的节点数据转换为 LiteGraph 节点
function createLiteGraphNodeFromDecoded(decodedNode) {
    // 根据节点类型选择创建不同的 LiteGraph 节点
    const nodeType = decodedNode.class_type === 'LoadImage' ? "comfyui/loadImage" : "comfyui/generic";
    const node = LiteGraph.createNode(nodeType);
    if (!node) return null;

    // 设置节点基本信息
    node.comfyui_id = decodedNode.id;
    node.comfyui_class_type = decodedNode.class_type;
    node.title = decodedNode.title;

    // 对于通用节点，动态创建 widgets
    if (nodeType === "comfyui/generic") {
        for (const widgetConfig of decodedNode.widgets) {
            node.createWidget(
                widgetConfig.name,
                widgetConfig.type,
                widgetConfig.value,
                widgetConfig.options
            );
        }
    }
    // 对于 LoadImage 节点，它的 widgets 是在节点类中静态定义的
    // 我们只需要把解码出的文件名设置给对应的 widget
    else if (nodeType === "comfyui/loadImage") {
        const imageNameWidget = node.widgets.find(w => w.name === "image");
        if (imageNameWidget) {
            imageNameWidget.value = decodedNode.widgets.find(w => w.name === "image")?.value || "";
        }
    }

    return node;
}

// 数值智能格式化：将 1.00, 2.00 转换为 1, 2，但保留 1.5, 2.3, 8.25
function formatNumberForComfyUI(value) {
    if (typeof value !== 'number') return value;

    // 使用更精确的方法检查是否为整数
    // 处理浮点数精度问题，如 1.0000000001 应该被视为 1
    const rounded = Math.round(value * 1000000) / 1000000; // 6位精度舍入

    if (Math.abs(rounded - Math.round(rounded)) < 0.000001) {
        // 如果舍入后的值非常接近整数，则返回整数
        return Math.round(rounded);
    } else {
        // 否则返回原值（保持小数）
        return value;
    }
}

// 简单网格排布算法
function calculateGridLayout(nodeCount, startX = 50, startY = 50) {
    const layouts = [];
    const nodeWidth = 400;
    const nodeHeight = 350;
    const cols = Math.ceil(Math.sqrt(nodeCount)); // 尽量接近正方形

    for (let i = 0; i < nodeCount; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;

        layouts.push({
            x: startX + col * nodeWidth,
            y: startY + row * nodeHeight
        });
    }

    return layouts;
}

// ComfyUI JSON 编码器
function encodeToComfyUIWorkflow() {
    if (!lgraphInstance) {
        console.error('LiteGraph 实例不存在');
        return null;
    }

    const workflowJson = {};
    const genericNodes = lgraphInstance.findNodesByType("comfyui/generic");
    const loadImageNodes = lgraphInstance.findNodesByType("comfyui/loadImage");
    const allNodes = [...genericNodes, ...loadImageNodes];

    for (const node of allNodes) {
        const nodeId = node.comfyui_id;
        const nodeData = {
            class_type: node.comfyui_class_type,
            inputs: {}
        };

        // 首先从原始 JSON 中复制所有输入（包括连接信息）
        if (originalWorkflowJson && originalWorkflowJson[nodeId] && originalWorkflowJson[nodeId].inputs) {
            nodeData.inputs = { ...originalWorkflowJson[nodeId].inputs };
        }

        // 然后用 widget 的当前值覆盖对应的参数
        if (node.widgets) {
            for (const widget of node.widgets) {
                // 跳过纯操作性的按钮，不将其编码到 inputs 中
                if (widget.type === 'button') {
                    continue;
                }

                let widgetValue = widget.value;
                const widgetName = widget.name;

                // 定义需要特殊处理的数字参数
                const integerParams = ['width', 'height', 'seed', 'noise_seed', 'steps'];
                const floatParams = ['cfg', 'denoise'];

                // 智能转换逻辑
                if (integerParams.includes(widgetName) || floatParams.includes(widgetName)) {
                    // 仅当值不是占位符时才尝试转换
                    if (typeof widgetValue === 'string' && !/^%.*%$/.test(widgetValue)) {
                        let num = Number(widgetValue);
                        if (!isNaN(num)) { // 如果能成功转为数字
                            if (integerParams.includes(widgetName)) {
                                widgetValue = Math.round(num); // 必须是整数的参数
                            } else {
                                widgetValue = num; // 可以是小数的参数
                            }
                        }
                    }
                }
                
                // 使用处理后的 widgetValue 覆盖原始值
                nodeData.inputs[widgetName] = widgetValue;
            }
        }

        // 处理 _meta 信息
        if (originalWorkflowJson && originalWorkflowJson[nodeId] && originalWorkflowJson[nodeId]._meta) {
            nodeData._meta = { ...originalWorkflowJson[nodeId]._meta };
        } else {
            // 如果原始 JSON 中没有 _meta，创建一个新的
            nodeData._meta = {};
        }

        // 保存当前节点的标题到 _meta.title
        nodeData._meta.title = node.title;

        workflowJson[node.comfyui_id] = nodeData;
    }

    return workflowJson;
}

// 保存 workflow 到设置
async function saveWorkflowToSettings() {
    const workflowJson = encodeToComfyUIWorkflow();
    if (!workflowJson) {
        console.error('[workflow-editor] Cannot encode workflow');
        alert('保存失败：无法编码 workflow');
        return;
    }

    // 获取当前打开的 workflow 名称作为默认值
    const extensionName = 'third-party/enhanced-comfyui-generator';
    const currentWorkflowName = extensionSettingsRef && extensionSettingsRef[extensionName]
        ? extensionSettingsRef[extensionName].currentWorkflow
        : null;

    const defaultName = currentWorkflowName || 'My Workflow';

    // 询问用户输入 workflow 名称
    const workflowName = prompt('请输入 Workflow 名称：', defaultName);
    if (!workflowName || workflowName.trim() === '') {
        return; // 用户取消或未输入名称
    }

    const finalName = workflowName.trim();
    console.log('[workflow-editor] Saving workflow:', finalName);

    try {
        // 保存 workflow 到 extension settings
        await saveWorkflowToExtensionSettings(finalName, workflowJson);

        console.log('[workflow-editor] Workflow 保存成功:', finalName);
        alert(`Workflow "${finalName}" 保存成功`);

        // 更新设置页面的下拉选项
        setTimeout(() => {
            updateWorkflowSelect();
            if (typeof window.updateWorkflowSelectOptions === 'function') {
                window.updateWorkflowSelectOptions();
            }
            // 更新删除按钮状态
            const deleteBtn = $('#delete-workflow-btn');
            deleteBtn.prop('disabled', false);
        }, 100);

    } catch (error) {
        console.error('[workflow-editor] Error saving workflow:', error);
        alert('保存 workflow 时出错: ' + error.message);
    }
}

// 保存 workflow 到 extension settings
async function saveWorkflowToExtensionSettings(workflowName, workflowJson) {
    // 检查全局变量引用是否可用
    if (!extensionSettingsRef || !saveSettingsDebounced) {
        console.error('[workflow-editor] Extension settings functions not available');
        throw new Error('扩展设置功能不可用，请确保从主扩展模块中正确初始化');
    }

    const extensionName = 'third-party/enhanced-comfyui-generator';

    // 初始化设置结构
    if (!extensionSettingsRef[extensionName]) {
        extensionSettingsRef[extensionName] = {
            enabled: true,
            comfyui_api_url: 'http://127.0.0.1:8188',
            workflows: {},
            currentWorkflow: null
        };
    }

    if (!extensionSettingsRef[extensionName].workflows) {
        extensionSettingsRef[extensionName].workflows = {};
    }

    // 保存 workflow（完整的 JSON 数据）
    extensionSettingsRef[extensionName].workflows[workflowName] = {
        name: workflowName,
        data: workflowJson,
        created: new Date().toISOString(),
        modified: new Date().toISOString()
    };

    // 更新当前选中的 workflow
    extensionSettingsRef[extensionName].currentWorkflow = workflowName;

    // 保存设置
    try {
        saveSettingsDebounced();
        console.log('[workflow-editor] Settings updated successfully');
    } catch (error) {
        console.error('[workflow-editor] Error saving settings:', error);
        throw error;
    }
}

// 更新设置页面的 workflow 下拉选项
function updateWorkflowSelect() {
    const extensionName = 'third-party/enhanced-comfyui-generator';
    const settings = extensionSettingsRef ? extensionSettingsRef[extensionName] : null;
    const select = $('#enhanced_comfyui_current_workflow');

    if (!select.length || !settings) return;

    // 清空现有选项
    select.empty();
    select.append('<option value="">无</option>');

    // 添加保存的 workflows
    if (settings.workflows) {
        Object.keys(settings.workflows).sort().forEach(name => {
            select.append(`<option value="${name}">${name}</option>`);
        });
    }

    // 设置当前选中的 workflow
    if (settings.currentWorkflow) {
        select.val(settings.currentWorkflow);
    }
}

// 从设置中获取选中的 workflow
function getSelectedWorkflow() {
    const extensionName = 'third-party/enhanced-comfyui-generator';
    const settings = extensionSettingsRef ? extensionSettingsRef[extensionName] : null;

    if (!settings || !settings.currentWorkflow || !settings.workflows) {
        return null;
    }

    return settings.workflows[settings.currentWorkflow];
}
function exportWorkflowJSON() {
    const workflowJson = encodeToComfyUIWorkflow();
    if (!workflowJson) {
        toastr.error('导出失败：无法编码 workflow');
        return;
    }

    const jsonString = JSON.stringify(workflowJson, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `comfyui-workflow-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('导出的 workflow JSON:', workflowJson);
    toastr.success('Workflow 导出成功');
}

// 导入 workflow JSON 文件
function importWorkflowJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const workflowJson = JSON.parse(e.target.result);
                console.log('导入的 workflow JSON:', workflowJson);

                // 加载新的 workflow 到编辑器
                loadWorkflowToEditor(workflowJson);
                toastr.success('Workflow 导入成功');

            } catch (error) {
                console.error('导入文件解析失败:', error);
                toastr.error('导入失败：文件格式无效');
            }
        };

        reader.readAsText(file);
    };

    input.click();
}

// 加载 workflow 到编辑器
async function loadWorkflowToEditor(workflowJson) {
    // 等待 LiteGraph 实例就绪
    let retries = 0;
    const maxRetries = 50; // 最大重试5秒

    while (!lgraphInstance && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
    }

    if (!lgraphInstance) {
        console.error('LiteGraph 实例不存在，等待超时');
        alert('编辑器还未完全初始化，请稍后再试');
        return;
    }

    console.log('开始加载 workflow 到编辑器:', workflowJson);

    // 清空当前图形
    lgraphInstance.clear();

    // 保存原始工作流 JSON，用于导出时保留连接信息
    originalWorkflowJson = workflowJson;

    // 解码 workflow JSON
    const decodedNodes = decodeComfyUIWorkflow(workflowJson);
    console.log('解码结果:', decodedNodes);

    // 计算网格布局
    const layouts = calculateGridLayout(decodedNodes.length);

    // 创建 LiteGraph 节点
    for (let i = 0; i < decodedNodes.length; i++) {
        const decodedNode = decodedNodes[i];
        const node = createLiteGraphNodeFromDecoded(decodedNode);

        if (node) {
            // 使用网格布局设置节点位置
            node.pos = [layouts[i].x, layouts[i].y];
            lgraphInstance.add(node);
            console.log(`创建节点: ${node.title} (ID: ${node.comfyui_id})`);
        }
    }

    // 重新启动图形
    lgraphInstance.start();
    console.log('Workflow 加载完成');
}

// 初始化 LiteGraph 实例
async function initializeLiteGraph() {
    if (!window.LiteGraph) {
        console.error('LiteGraph 未加载');
        return false;
    }

    // 首先尝试从 ComfyUI API 获取模型列表
    console.log('[workflow-editor] 尝试从 ComfyUI API 获取模型列表...');
    await fetchComfyUILists();

    // 应用全局节点样式
    LiteGraph.NODE_TITLE_COLOR = nodeStyles.global.nodeTitleColor;
    LiteGraph.NODE_TITLE_HEIGHT = nodeStyles.global.nodeTitleHeight;
    LiteGraph.NODE_DEFAULT_COLOR = nodeStyles.global.nodeDefaultColor;
    LiteGraph.NODE_DEFAULT_BGCOLOR = nodeStyles.global.nodeDefaultBgColor;

    // 获取画布元素
    const canvas = document.getElementById('workflow-canvas');
    if (!canvas) {
        console.error('找不到工作流画布元素');
        return false;
    }

    // 设置画布尺寸
    const modalBody = $('.workflow-modal-body');
    const width = modalBody.width() - 20;
    const height = modalBody.height() - 20;

    canvas.width = width;
    canvas.height = height;

    // 创建全新的空白图形实例
    lgraphInstance = new LGraph();
    canvasInstance = new LGraphCanvas("#workflow-canvas", lgraphInstance);

    // 注册通用 ComfyUI 节点类型
    LiteGraph.registerNodeType("comfyui/generic", ComfyUINode);

    // 注册自定义的 LoadImage 节点类型
    registerLoadImageNodeType();

    // 确保图形是完全空白的
    lgraphInstance.clear();

    // 测试解码器 - 使用真实的 ComfyUI workflow JSON
    const testWorkflowJson = {
        "3": {
            "inputs": {
                "seed": 156680208700286,
                "steps": 20,
                "cfg": 8,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            },
            "class_type": "KSampler",
            "_meta": {
                "title": "KSampler"
            }
        },
        "4": {
            "inputs": {
                "ckpt_name": "v1-5-pruned-emaonly-fp16.safetensors"
            },
            "class_type": "CheckpointLoaderSimple",
            "_meta": {
                "title": "Load Checkpoint"
            }
        },
        "5": {
            "inputs": {
                "width": 512,
                "height": 512,
                "batch_size": 1
            },
            "class_type": "EmptyLatentImage",
            "_meta": {
                "title": "Empty Latent Image"
            }
        },
        "6": {
            "inputs": {
                "text": "beautiful scenery nature glass bottle landscape, , purple galaxy bottle,",
                "clip": ["4", 1]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {
                "title": "CLIP Text Encode (Prompt)"
            }
        },
        "7": {
            "inputs": {
                "text": "text, watermark",
                "clip": ["4", 1]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {
                "title": "CLIP Text Encode (Prompt)"
            }
        },
        "8": {
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2]
            },
            "class_type": "VAEDecode",
            "_meta": {
                "title": "VAE Decode"
            }
        },
        "9": {
            "inputs": {
                "filename_prefix": "ComfyUI",
                "images": ["8", 0]
            },
            "class_type": "SaveImage",
            "_meta": {
                "title": "Save Image"
            }
        }
    };

    // 保存原始工作流 JSON，用于导出时保留连接信息
    originalWorkflowJson = testWorkflowJson;

    // 解码 workflow JSON
    const decodedNodes = decodeComfyUIWorkflow(testWorkflowJson);
    console.log('解码结果:', decodedNodes);

    // 计算网格布局
    const layouts = calculateGridLayout(decodedNodes.length);

    // 创建 LiteGraph 节点
    for (let i = 0; i < decodedNodes.length; i++) {
        const decodedNode = decodedNodes[i];
        const node = createLiteGraphNodeFromDecoded(decodedNode);

        if (node) {
            // 使用网格布局设置节点位置
            node.pos = [layouts[i].x, layouts[i].y];
            lgraphInstance.add(node);
            console.log(`创建节点: ${node.title} (ID: ${node.comfyui_id})`);
        }
    }

    // 启动图形
    lgraphInstance.start();

    // 启动后，立即调用一次 resize 来确保画布尺寸正确并进行首次绘制
    handleResize.immediate();

    console.log('LiteGraph 初始化成功 - 包含测试节点');
    return true;
}

// 创建模态窗口编辑器
function createWorkflowModal() {
    const modalHTML = `
        <div id="workflow-editor-modal" class="workflow-modal" style="display: none;">
            <div class="workflow-modal-overlay"></div>
            <div class="workflow-modal-content">
                <div class="workflow-modal-header">
                    <h3>Comfyui 工作流编辑器</h3>
                    <div class="workflow-modal-controls">
                        <button id="workflow-import-btn" class="btn">
                            <i class="fa fa-upload"></i> 导入 JSON
                        </button>
                        <button id="workflow-export-btn" class="btn">
                            <i class="fa fa-download"></i> 导出 JSON
                        </button>
                        <button id="workflow-test-btn" class="btn btn-success">
                            <i class="fa fa-play"></i> 测试运行
                        </button>
                        <button id="workflow-save-btn" class="btn">
                            <i class="fa fa-save"></i> 保存 Workflow
                        </button>
                        <button id="workflow-close-btn" class="btn">
                            <i class="fa fa-times"></i> 关闭
                        </button>
                    </div>
                </div>
                <div class="workflow-modal-body">
                    <canvas id="workflow-canvas" class="workflow-canvas"></canvas>
                    <div id="workflow-result-panel" class="workflow-result-panel" style="display: none;">
                        <div class="workflow-result-header">
                            <h4>任务队列</h4>
                            <div class="queue-controls">
                                <button id="workflow-clear-all" class="btn-small" title="清空所有任务">
                                    <i class="fa fa-trash"></i>
                                </button>
                                <button id="workflow-result-close" class="btn-small">
                                    <i class="fa fa-times"></i>
                                </button>
                            </div>
                        </div>
                        <div class="workflow-result-content">
                            <div id="workflow-task-queue" class="workflow-task-queue">
                                <!-- 任务卡片将动态添加到这里 -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // 移除已存在的模态窗口
    $('#workflow-editor-modal').remove();

    // 将模态窗口添加到页面
    $('body').append(modalHTML);

    // 绑定事件
    $('#workflow-close-btn').on('click', closeWorkflowEditor);
    $('#workflow-export-btn').on('click', exportWorkflowJSON);
    $('#workflow-import-btn').on('click', importWorkflowJSON);
    $('#workflow-save-btn').on('click', saveWorkflowToSettings);
    $('#workflow-test-btn').on('click', testWorkflowExecution);
    $('#workflow-result-close').on('click', hideResultPanel);
    $('#workflow-clear-all').on('click', clearAllTasks);
    $('.workflow-modal-overlay').on('click', closeWorkflowEditor);

    // 阻止模态内容区域的点击事件冒泡
    $('.workflow-modal-content').on('click', function(e) {
        e.stopPropagation();
    });
}

// 关闭工作流编辑器
function closeWorkflowEditor() {
    // 移除窗口缩放监听器
    window.removeEventListener('resize', handleResize);

    $('#workflow-editor-modal').fadeOut(300, function() {
        $(this).remove();
    });

    // 清理实例
    if (lgraphInstance) {
        lgraphInstance.stop();
        lgraphInstance = null;
    }
    canvasInstance = null;
}

// 处理窗口缩放的函数
const handleResize = debounce(() => {
    if (!canvasInstance || !lgraphInstance) return;

    const canvas = document.getElementById('workflow-canvas');
    const modalBody = $('.workflow-modal-body');

    if (canvas && modalBody.length) {
        const rect = modalBody[0].getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // 设置 CSS 尺寸
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;

        // 设置 Canvas 内部绘图尺寸，以匹配物理像素
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        // 获取 2D 上下文并进行缩放，让绘图坐标与 CSS 坐标对齐
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // 通知 LiteGraph 实例
        canvasInstance.resize(canvas.width, canvas.height); // 传递新的物理尺寸
        canvasInstance.draw(); // 在 canvas 实例上调用 draw，而不是 graph 实例
    }
}, 150); // 150ms 的防抖延迟

// 显示工作流编辑器
function showWorkflowEditor() {
    return new Promise((resolve, reject) => {
        // 创建模态窗口
        createWorkflowModal();

        // 显示模态窗口
        $('#workflow-editor-modal').fadeIn(300);

        // 添加窗口缩放监听器
        window.addEventListener('resize', handleResize);

        // 等待模态窗口完全显示后初始化 LiteGraph
        setTimeout(async () => {
            try {
                await initializeLiteGraph();
                resolve(); // 当初始化成功时，resolve Promise
            } catch (error) {
                reject(error); // 当初始化失败时，reject Promise
            }
        }, 100);
    });
}

// 动态加载 LiteGraph 资源
async function loadLiteGraphResources() {
    // 加载 LiteGraph.js
    if (!window.LiteGraph) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/scripts/extensions/third-party/enhanced-comfyui-generator/js/litegraph.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // 加载 CSS 文件
    const cssFiles = [
        // '/scripts/extensions/third-party/enhanced-comfyui-generator/css/litegraph-editor.css',
        '/scripts/extensions/third-party/enhanced-comfyui-generator/css/litegraph-modal.css'
    ];

    for (const cssFile of cssFiles) {
        if (!document.querySelector(`link[href="${cssFile}"]`)) {
            await new Promise((resolve) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = cssFile;
                link.onload = resolve;
                link.onerror = resolve; // 不阻塞，某些 CSS 可能不存在
                document.head.appendChild(link);
            });
        }
    }
}

// 隐藏结果面板
function hideResultPanel() {
    $('#workflow-result-panel').fadeOut(300);
}

// 显示结果面板
function showResultPanel() {
    $('#workflow-result-panel').fadeIn(300);
}

// 任务管理
let taskCounter = 0;

// 测试 workflow 执行
async function testWorkflowExecution() {
    console.log('[workflow-editor] Starting workflow test execution');

    // 1. 获取当前 workflow JSON
    const workflowJson = encodeToComfyUIWorkflow();
    if (!workflowJson) {
        alert('无法编码当前 workflow，请检查编辑器内容');
        return;
    }

    // 2. UI 准备
    showResultPanel();
    const taskId = `task_${++taskCounter}`;
    createTaskCard(taskId);
    updateTaskStatus(taskId, 'running', '正在提交...');
    showTaskProgress(taskId, 10, '编码并提交到执行器...');

    const startTime = Date.now(); // 记录开始时间

    // 3. 定义进度更新回调函数
    const onProgress = (status) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1); // 计算实时耗时

        switch (status.status) {
            case 'submitted':
                updateTaskStatus(taskId, 'running', '已提交，等待执行...');
                showTaskProgress(taskId, 25, `任务ID: ${status.promptId}`);
                break;
            case 'queued':
                const queuePos = status.queuePosition || '未知';
                showTaskProgress(taskId, 35, `排队中 (位置: ${queuePos}) - ${elapsed}s`);
                break;
            case 'executing':
                showTaskProgress(taskId, 65, `正在处理中... - ${elapsed}s`);
                break;
        }
    };

    try {
        // 4. 调用核心执行引擎，并传入进度回调
        const outputs = await executeWorkflowInComfyUI(workflowJson, onProgress);
        
        // 5. 处理成功结果并更新 UI
        const duration = (Date.now() - startTime) / 1000; // 计算总耗时
        console.log('[workflow-editor] Execution successful, outputs:', outputs);
        updateTaskStatus(taskId, 'success', '执行完成', duration); // 传递总耗时
        showTaskProgress(taskId, 100, '生成完成');
        await displayTaskResults(taskId, outputs);
        hideTaskProgress(taskId);

    } catch (error) {
        // 6. 处理失败结果并更新 UI
        console.error('[workflow-editor] Workflow execution failed:', error);
        updateTaskStatus(taskId, 'error', '执行失败');
        showTaskError(taskId, error.message || '未知错误');
        hideTaskProgress(taskId);
    }
}

// 创建任务卡片
function createTaskCard(taskId) {
    const timestamp = new Date().toLocaleTimeString();
    const taskHTML = `
        <div class="workflow-task-card" data-task-id="${taskId}">
            <div class="task-header">
                <div class="task-info">
                    <span class="task-title">任务 #${taskCounter}</span>
                    <span class="task-time">${timestamp}</span>
                </div>
                <button class="task-remove-btn btn-small" data-task-id="${taskId}" title="删除任务">
                    <i class="fa fa-times"></i>
                </button>
            </div>
            <div class="task-body">
                <div class="task-status" data-task-id="${taskId}">初始化中...</div>
                <div class="task-progress" data-task-id="${taskId}" style="display: none;">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="progress-text">等待中...</div>
                </div>
                <div class="task-images" data-task-id="${taskId}"></div>
                <div class="task-error" data-task-id="${taskId}" style="display: none;"></div>
            </div>
        </div>
    `;

    const taskQueue = $('#workflow-task-queue');
    taskQueue.prepend(taskHTML); // 新任务添加到顶部

    // 绑定删除按钮事件
    $(`.task-remove-btn[data-task-id="${taskId}"]`).on('click', function() {
        removeTask(taskId);
    });

    return taskId;
}

// 清空所有任务
function clearAllTasks() {
    if ($('#workflow-task-queue').children().length === 0) return;

    if (confirm('确定要清空所有任务吗？这将删除所有任务记录和结果。')) {
        $('#workflow-task-queue').empty();
        taskCounter = 0;
    }
}

// 删除单个任务
function removeTask(taskId) {
    $(`.workflow-task-card[data-task-id="${taskId}"]`).fadeOut(300, function() {
        $(this).remove();
    });
}

// 更新任务状态
function updateTaskStatus(taskId, status, message, duration) {
    const statusElement = $(`.task-status[data-task-id="${taskId}"]`);
    statusElement.removeClass('running success error').addClass(status);
    
    let text = message;
    if (duration !== undefined) {
        text += ` (耗时: ${duration.toFixed(1)}s)`;
    }
    statusElement.text(text);
}

// 显示任务进度
function showTaskProgress(taskId, percent, message) {
    const progressContainer = $(`.task-progress[data-task-id="${taskId}"]`);
    const progressFill = progressContainer.find('.progress-fill');
    const progressText = progressContainer.find('.progress-text');

    progressContainer.show();
    progressFill.css('width', percent + '%');
    progressText.text(message);
}

// 隐藏任务进度条
function hideTaskProgress(taskId) {
    $(`.task-progress[data-task-id="${taskId}"]`).hide();
}

// 显示任务错误
function showTaskError(taskId, message) {
    const errorContainer = $(`.task-error[data-task-id="${taskId}"]`);
    errorContainer.html(`<strong>错误:</strong> ${message}`).show();
}

// 显示任务结果
async function displayTaskResults(taskId, outputs) {
    const imagesContainer = $(`.task-images[data-task-id="${taskId}"]`);
    imagesContainer.empty();

    if (!outputs) {
        imagesContainer.append('<p style="color: #999; font-size: 12px;">没有生成结果</p>');
        return;
    }

    const videoExtensions = ['mp4', 'webm', 'mov', 'avi'];

    // 遍历所有输出
    for (const [nodeId, nodeOutputs] of Object.entries(outputs)) {
        // 检查多种可能的输出 key，以兼容不同的自定义节点
        const files = nodeOutputs.images || nodeOutputs.videos || nodeOutputs.gifs || nodeOutputs.files;

        if (files) {
            for (const fileInfo of files) {
                const fileUrl = `${comfyUIApiBase}/view?filename=${fileInfo.filename}&subfolder=${fileInfo.subfolder}&type=${fileInfo.type}`;
                const fileExt = fileInfo.filename.split('.').pop().toLowerCase();

                let mediaElement;

                if (videoExtensions.includes(fileExt)) {
                    // Create a video element
                    mediaElement = $(`
                        <div class="task-result-image">
                            <video src="${fileUrl}" controls autoplay muted loop playsinline loading="lazy" style="width: 100%; height: auto;"></video>
                            <div class="image-info">
                                <small>节点 ${nodeId}: ${fileInfo.filename}</small>
                            </div>
                        </div>
                    `);
                    mediaElement.find('video').on('click', function() {
                        window.open(fileUrl, '_blank');
                    });
                } else {
                    // Create an image element
                    mediaElement = $(`
                        <div class="task-result-image">
                            <img src="${fileUrl}" alt="Generated Image" loading="lazy">
                            <div class="image-info">
                                <small>节点 ${nodeId}: ${fileInfo.filename}</small>
                            </div>
                        </div>
                    `);
                    mediaElement.find('img').on('click', function() {
                        window.open(fileUrl, '_blank');
                    });
                }

                imagesContainer.append(mediaElement);
            }
        }
    }

    if (imagesContainer.children().length === 0) {
        imagesContainer.append('<p style="color: #999; font-size: 12px; text-align: center;">没有生成图片或视频结果</p>');
    }
}

// 主入口函数 - 供 index.js 调用
async function createWorkflowEditor() {
    try {
        console.log('[workflow-editor] Loading resources...');

        // 加载必要资源
        await loadLiteGraphResources();

        console.log('[workflow-editor] Resources loaded, showing editor...');

        // 显示编辑器
        await showWorkflowEditor();

        console.log('[workflow-editor] Workflow editor created successfully');

    } catch (error) {
        console.error('[workflow-editor] Error creating workflow editor:', error);
        throw error;
    }
}

// ES6 模块导出
export {
    createWorkflowEditor,
    showWorkflowEditor,
    closeWorkflowEditor,
    exportWorkflowJSON,
    importWorkflowJSON,
    loadWorkflowToEditor,
    encodeToComfyUIWorkflow,
    decodeComfyUIWorkflow,
    setComfyUIApiBase,
    initializeGlobalReferences,
    fetchComfyUILists,
    saveWorkflowToSettings,
    updateWorkflowSelect,
    getSelectedWorkflow
};

// 向后兼容 - 仍然提供 window.WorkflowEditor
window.WorkflowEditor = {
    show: showWorkflowEditor,
    close: closeWorkflowEditor,
    create: createWorkflowEditor,
    import: importWorkflowJSON,
    export: exportWorkflowJSON,
    updateWorkflowSelect: updateWorkflowSelect
};
