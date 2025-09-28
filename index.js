import {
    saveSettingsDebounced,
} from '../../../../script.js';

import {
    extension_settings,
    renderExtensionTemplateAsync,
} from '../../../extensions.js';

// 扩展名称
const extensionName = 'third-party/enhanced-comfyui-generator';
const extensionFolderPath = 'third-party/enhanced-comfyui-generator';

console.log('[enhanced-comfyui-generator] Extension script loaded');

// 默认设置
const defaultSettings = {
    enabled: true,
    comfyui_api_url: 'http://127.0.0.1:8188',
    comfyui_api_url_i2v: '', // New field for the video instance
    workflows: {},
    currentWorkflow: null,
    defaultWidth: 512,
    defaultHeight: 768,
};

// 初始化设置
function initSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }
    // 兼容旧设置，补充新字段
    if (extension_settings[extensionName].defaultWidth === undefined) {
        extension_settings[extensionName].defaultWidth = defaultSettings.defaultWidth;
    }
    if (extension_settings[extensionName].defaultHeight === undefined) {
        extension_settings[extensionName].defaultHeight = defaultSettings.defaultHeight;
    }
    if (extension_settings[extensionName].comfyui_api_url_i2v === undefined) {
        extension_settings[extensionName].comfyui_api_url_i2v = defaultSettings.comfyui_api_url_i2v;
    }
}

// 更新设置UI
function updateSettingsUI() {
    const settings = extension_settings[extensionName];
    $('#enhanced_comfyui_enabled').prop('checked', settings.enabled);
    $('#enhanced_comfyui_api_url').val(settings.comfyui_api_url);
    $('#enhanced_comfyui_api_url_i2v').val(settings.comfyui_api_url_i2v);
    $('#enhanced_comfyui_default_width').val(settings.defaultWidth);
    $('#enhanced_comfyui_default_height').val(settings.defaultHeight);
    
    // 更新 workflow 下拉选项
    updateWorkflowSelectOptions();
    
    // 初始化删除按钮状态
    const deleteBtn = $('#delete-workflow-btn');
    deleteBtn.prop('disabled', !settings.currentWorkflow);
}

// 更新 workflow 下拉选项
async function updateWorkflowSelectOptions() {
    const settings = extension_settings[extensionName];
    const select = $('#enhanced_comfyui_current_workflow');
    
    if (!select.length) return;

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

    // 更新全局注册表
    updateGlobalWorkflowRegistry();
}

// 全局模块引用
let editorModule = null;
let executorModule = null;

// 动态加载模块的辅助函数
async function loadModules() {
    try {
        editorModule = await import(`/scripts/extensions/${extensionFolderPath}/workflow-editor.js`);
        executorModule = await import(`/scripts/extensions/${extensionFolderPath}/workflow-executor.js`);
        
        // 模块加载后，立即进行初始化配置
        updateApiBaseUrl();

    } catch (error) {
        console.error('[enhanced-comfyui-generator] Failed to load modules:', error);
        throw error;
    }
}

// 更新 API 地址到所有模块
function updateApiBaseUrl() {
    const settings = extension_settings[extensionName];
    const apiUrl = settings?.comfyui_api_url;

    if (!apiUrl) {
        console.warn('[enhanced-comfyui-generator] ComfyUI API URL is not set.');
        return;
    }

    if (editorModule && editorModule.setComfyUIApiBase) {
        editorModule.setComfyUIApiBase(apiUrl);
    }
    if (executorModule && executorModule.setExecutorApiBase) {
        executorModule.setExecutorApiBase(apiUrl);
    }
}

// 打开工作流编辑器
async function openWorkflowEditor() {
    console.log('[enhanced-comfyui-generator] Opening workflow editor...');

    try {
        const settings = extension_settings[extensionName];
        if (!settings.enabled) {
            alert('请先启用 Enhanced ComfyUI Generator 扩展');
            return;
        }

        // 确保模块已加载
        if (!editorModule || !executorModule) {
            await loadModules();
        }

        // 初始化编辑器模块的全局引用
        if (editorModule.initializeGlobalReferences) {
            editorModule.initializeGlobalReferences(extension_settings, saveSettingsDebounced);
        }

        // 创建并打开编辑器
        if (editorModule && editorModule.createWorkflowEditor) {
            await editorModule.createWorkflowEditor();
            
            // 如果有选中的 workflow，加载它
            if (settings.currentWorkflow && settings.workflows && settings.workflows[settings.currentWorkflow]) {
                const workflowData = settings.workflows[settings.currentWorkflow].data;
                if (workflowData && editorModule.loadWorkflowToEditor) {
                    console.log('[enhanced-comfyui-generator] Loading selected workflow:', settings.currentWorkflow);
                    await editorModule.loadWorkflowToEditor(workflowData);
                }
            }
        } else {
            throw new Error('Workflow editor module not properly loaded');
        }

    } catch (error) {
        console.error('[enhanced-comfyui-generator] Error opening workflow editor:', error);
        alert('打开工作流编辑器时出错: ' + error.message);
    }
}

// 设置变更处理
function onSettingsChange() {
    const settings = extension_settings[extensionName];
    settings.enabled = $('#enhanced_comfyui_enabled').is(':checked');
    settings.comfyui_api_url = $('#enhanced_comfyui_api_url').val();
    settings.comfyui_api_url_i2v = $('#enhanced_comfyui_api_url_i2v').val();
    settings.defaultWidth = Number($('#enhanced_comfyui_default_width').val());
    settings.defaultHeight = Number($('#enhanced_comfyui_default_height').val());
    
    saveSettingsDebounced();
    updateApiBaseUrl(); // 当 API 地址变更时，立即更新到所有模块
    console.log('[enhanced-comfyui-generator] Settings changed.');
}

// workflow 选择变更处理
function onWorkflowChange() {
    const selectedWorkflow = $('#enhanced_comfyui_current_workflow').val();
    extension_settings[extensionName].currentWorkflow = selectedWorkflow || null;
    
    // 启用/禁用删除按钮
    const deleteBtn = $('#delete-workflow-btn');
    deleteBtn.prop('disabled', !selectedWorkflow);
    
    saveSettingsDebounced();
    console.log('[enhanced-comfyui-generator] Selected workflow changed:', selectedWorkflow);
}

// 删除 workflow
async function deleteWorkflow() {
    const selectedWorkflow = $('#enhanced_comfyui_current_workflow').val();
    if (!selectedWorkflow) {
        return;
    }

    const confirmMessage = `确定要删除工作流 "${selectedWorkflow}" 吗？此操作不可撤销。`;
    if (!confirm(confirmMessage)) {
        return;
    }

    const settings = extension_settings[extensionName];
    
    try {
        // 删除 workflow
        if (settings.workflows && settings.workflows[selectedWorkflow]) {
            delete settings.workflows[selectedWorkflow];
        }

        // 清空当前选择
        settings.currentWorkflow = null;

        // 保存设置
        saveSettingsDebounced();

        // 更新UI和全局注册表
        updateWorkflowSelectOptions();
        updateGlobalWorkflowRegistry(); // <--- 添加调用

        console.log('[enhanced-comfyui-generator] Workflow deleted:', selectedWorkflow);
        toastr.success(`工作流 "${selectedWorkflow}" 已删除`);
        
    } catch (error) {
        console.error('[enhanced-comfyui-generator] Error deleting workflow:', error);
        alert('删除工作流时出错: ' + error.message);
    }
}

// jQuery 初始化
jQuery(async () => {
    try {
        console.log('[enhanced-comfyui-generator] Initializing extension...');
        await new Promise(resolve => setTimeout(resolve, 100));
        // 初始化设置
        initSettings();

        // Load and add settings UI
        const settingsHtml = $(await renderExtensionTemplateAsync(extensionName, 'settings'));
        $('#extensions_settings').append(settingsHtml);
        console.log(`[${extensionName}] Settings UI added`);

        // Wait for UI to be added to DOM
        await new Promise(resolve => setTimeout(resolve, 50));

        // 更新设置UI
        updateSettingsUI();

        // 绑定设置变更事件
        $('#enhanced_comfyui_enabled').on('change', onSettingsChange);
        $('#enhanced_comfyui_api_url').on('input', onSettingsChange);
        $('#enhanced_comfyui_api_url_i2v').on('input', onSettingsChange);
        $('#enhanced_comfyui_default_width').on('input', onSettingsChange);
        $('#enhanced_comfyui_default_height').on('input', onSettingsChange);
        $('#enhanced_comfyui_current_workflow').on('change', onWorkflowChange);
        $('#delete-workflow-btn').on('click', deleteWorkflow);

        // 绑定打开编辑器按钮
        $('#open-workflow-editor').on('click', openWorkflowEditor);

        console.log('[enhanced-comfyui-generator] Extension initialized successfully');

        // 启用编辑器按钮
        $('#open-workflow-editor').prop('disabled', false);

        // 将更新函数暴露为全局函数，供 workflow-editor.js 调用
        window.updateWorkflowSelectOptions = updateWorkflowSelectOptions;

        // 设置事件监听器，用于外部API调用
        document.addEventListener('st:comfyui:generate', handleApiGenerate);

        // 首次加载时，更新一次全局注册表
        updateGlobalWorkflowRegistry();

    } catch (error) {
        console.error('[enhanced-comfyui-generator] Extension initialization failed:', error);
    }
});

// 处理外部API调用的事件处理器
async function handleApiGenerate(event) {
    const { detail } = event;
    console.log('[enhanced-comfyui-generator] Received API generate event:', detail);

    const { onComplete, genType } = detail;
    if (!onComplete) {
        console.error('[enhanced-comfyui-generator] API call missing required parameter: onComplete.');
        return;
    }

    try {
        const settings = extension_settings[extensionName];
        
        // Step 1: Determine the target API URL based on genType
        let targetApiUrl = settings.comfyui_api_url;
        if (genType === 'img2img' && settings.comfyui_api_url_i2v) {
            targetApiUrl = settings.comfyui_api_url_i2v;
            console.log(`[enhanced-comfyui-generator] Rerouting to I2V instance: ${targetApiUrl}`);
        }

        // 2. 配置合并逻辑
        const options = {
            messageId: detail.messageId, // Pass the messageId through
            workflowName: detail.workflowName || settings.currentWorkflow,
            prompt: detail.prompt,
            inputImageUrl: detail.inputImageUrl,
            width: detail.width || settings.defaultWidth,
            height: detail.height || settings.defaultHeight,
            characterName: detail.characterName,
            onComplete: detail.onComplete,
            targetApiUrl: targetApiUrl, // Pass the determined URL to the executor
        };

        // 3. 基础参数校验 (基于合并后的配置)
        if (!options.workflowName) {
            throw new Error('No workflow specified and no default workflow is set.');
        }

        // 4. 加载工作流
        const workflowData = settings.workflows?.[options.workflowName]?.data;
        if (!workflowData) {
            throw new Error(`Workflow "${options.workflowName}" not found.`);
        }
        options.workflowData = workflowData;

        const workflowString = JSON.stringify(workflowData);

        // 5. 占位符依赖校验
        if (workflowString.includes('%prompt%') && !options.prompt) {
            throw new Error(`Workflow "${options.workflowName}" requires a 'prompt', but none was provided.`);
        }
        if (workflowString.includes('%image_name%') && !options.inputImageUrl) {
            throw new Error(`Workflow "${options.workflowName}" requires an 'inputImageUrl', but none was provided.`);
        }
        if (workflowString.includes('%width%')) {
            if (typeof options.width !== 'number' || !options.width) {
                throw new Error(`Workflow "${options.workflowName}" requires a 'width' (number), but none was provided.`);
            }
            options.width = Math.round(options.width);
        }
        if (workflowString.includes('%height%')) {
            if (typeof options.height !== 'number' || !options.height) {
                throw new Error(`Workflow "${options.workflowName}" requires a 'height' (number), but none was provided.`);
            }
            options.height = Math.round(options.height);
        }

        // --- 核心自动化流程开始 ---
        if (!executorModule) await loadModules();
        
        // Temporarily set the executor's API base for this specific call
        executorModule.setExecutorApiBase(targetApiUrl);
        
        await executorModule.executeAutomatedWorkflow(options);

        // IMPORTANT: Revert the executor's API base to the main URL for subsequent calls
        executorModule.setExecutorApiBase(settings.comfyui_api_url);


    } catch (error) {
        console.error('[enhanced-comfyui-generator] Error during API generation process:', error);
        onComplete(null, error);
    }
}

/**
 * Updates a global registry with the current list of workflow names.
 * This allows other extensions to discover available workflows.
 */
function updateGlobalWorkflowRegistry() {
    // Ensure the plugin namespace exists
    window.SillyTavern = window.SillyTavern || {};
    window.SillyTavern.plugins = window.SillyTavern.plugins || {};
    window.SillyTavern.plugins.comfyui = window.SillyTavern.plugins.comfyui || {};

    const settings = extension_settings[extensionName];
    const workflowNames = settings.workflows ? Object.keys(settings.workflows).sort() : [];

    // Update the global variable
    window.SillyTavern.plugins.comfyui.workflows = workflowNames;

    // Dispatch a custom event to notify other extensions of the update
    document.dispatchEvent(new CustomEvent('st:comfyui:workflows_updated', {
        detail: {
            workflows: workflowNames,
            source: extensionName,
        }
    }));

    console.log('[enhanced-comfyui-generator] Global workflow registry updated:', workflowNames);
}
