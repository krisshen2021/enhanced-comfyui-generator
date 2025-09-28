import { getRequestHeaders } from '../../../../script.js';

// SillyTavern Enhanced ComfyUI Generator - Workflow Executor
// This module is responsible for the programmatic, automated execution of workflows.
// It is called by index.js and is decoupled from the UI.

let comfyUIApiBase = null;
let centralPollingInterval = null;
const pendingTasks = {}; // The new task pool

/**
 * Sets the ComfyUI API base URL.
 * @param {string} url 
 */
export function setExecutorApiBase(url) {
    comfyUIApiBase = url;
}

/**
 * Starts the central polling loop.
 */
function startCentralPolling() {
    if (centralPollingInterval) return; // Prevent multiple intervals
    console.log('[workflow-executor] Starting central polling loop...');
    centralPollingInterval = setInterval(pollComfyUI, 2000); // Poll every 2 seconds
}

/**
 * The core polling function that checks the status of all pending tasks.
 */
async function pollComfyUI() {
    const taskIds = Object.keys(pendingTasks);
    if (taskIds.length === 0) return;

    console.log(`[DEBUG] Polling for ${taskIds.length} tasks:`, taskIds);

    try {
        // We can't easily check all queues at once, so we iterate.
        for (const promptId of taskIds) {
            const task = pendingTasks[promptId];
            const taskApiUrl = task.apiUrl;

            // Step 1: Check the queue for the specific task's server
            const queueResponse = await fetch(`${taskApiUrl}/queue`);
            if (!queueResponse.ok) {
                console.warn(`[workflow-executor] Failed to fetch queue status from ${taskApiUrl}.`);
                continue; // Skip to next task
            }
            const queue = await queueResponse.json();
            const isRunning = queue.queue_running.some(item => item[1] === promptId);
            const isPending = queue.queue_pending.some(item => item[1] === promptId);

            if (isRunning || isPending) {
                console.log(`[DEBUG] Task ${promptId} is still running or pending on ${taskApiUrl}.`);
                continue;
            }

            // Step 2: If not in queue, check history on the specific task's server
            console.log(`[DEBUG] Task ${promptId} not in queue on ${taskApiUrl}. Checking history...`);
            const historyResponse = await fetch(`${taskApiUrl}/history/${promptId}`);
            if (historyResponse.ok) {
                const history = await historyResponse.json();
                if (history[promptId]) {
                    console.log(`[workflow-executor] Task ${promptId} found in history on ${taskApiUrl}. Processing...`);
                    delete pendingTasks[promptId];
                    await processCompletedTask(task, history[promptId].outputs);
                } else {
                    task.notFoundCounter = (task.notFoundCounter || 0) + 1;
                    if (task.notFoundCounter > 5) {
                        console.error(`[workflow-executor] Task ${promptId} lost on ${taskApiUrl}. Removing from pool.`);
                        delete pendingTasks[promptId];
                        task.onComplete?.(null, new Error(`Task ${promptId} was lost and not found in history.`), task.messageId);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[workflow-executor] Error during polling:', error);
    }
}

/**
 * Processes a completed task: downloads the result, uploads to SillyTavern, and calls the final callback.
 * @param {object} task - The task object from the pendingTasks pool.
 * @param {object} outputs - The outputs from the ComfyUI history.
 */
async function processCompletedTask(task, outputs) {
    try {
        let finalUrl = null;
        for (const nodeId in outputs) {
            const nodeOutput = outputs[nodeId];
            const files = nodeOutput.images || nodeOutput.videos || nodeOutput.gifs || nodeOutput.files;
            if (files && files.length > 0) {
                const firstFile = files[0];
                // Use the task-specific API URL for downloading
                finalUrl = await processAndUploadImage(firstFile, task.characterName, task.apiUrl);
                break;
            }
        }

        if (!finalUrl) {
            throw new Error('No output file found in the ComfyUI result.');
        }

        task.onComplete?.(finalUrl, null, task.messageId);

    } catch (error) {
        console.error('[workflow-executor] Error processing completed task:', error);
        task.onComplete?.(null, error, task.messageId);
    }
}


/**
 * Generates a unique client ID for ComfyUI submissions.
 * @returns {string}
 */
function generateClientId() {
    return 'sillytavern_extension_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Submits a workflow to the ComfyUI API.
 * @param {object} workflowJson - The workflow to execute.
 * @returns {Promise<string>} The prompt ID of the submitted task.
 */
async function submitWorkflowToComfyUI(workflowJson) {
    console.log('%c[WORKFLOW_INTERCEPT]', 'color: #FFD700; font-weight: bold;', 'Submitting the following workflow to ComfyUI:');
    console.log(JSON.stringify(workflowJson, null, 2));

    const response = await fetch(`${comfyUIApiBase}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: workflowJson,
            client_id: generateClientId()
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    if (result.error) {
        throw new Error(result.error.message || 'Failed to submit workflow');
    }

    return result.prompt_id;
}

/**
 * A simplified, blocking polling function specifically for the workflow editor's "Test Run".
 * It does NOT use the central task pool.
 * @param {string} promptId 
 * @param {function} onProgress 
 * @returns {Promise<object>}
 */
async function pollUntilCompleteSimple(promptId, onProgress) {
    const maxAttempts = 300; // Max poll for 10 minutes (300 * 2s)
    let attempts = 0;

    while (attempts < maxAttempts) {
        attempts++;
        try {
            // For the simple test run, we only need to check the history endpoint.
            const historyResponse = await fetch(`${comfyUIApiBase}/history/${promptId}`);
            if (historyResponse.ok) {
                const history = await historyResponse.json();
                if (history[promptId]) {
                    console.log(`[workflow-executor] Test task ${promptId} completed.`);
                    onProgress?.({ status: 'completed' });
                    return history[promptId].outputs;
                }
            }
        } catch (error) {
            console.error(`[workflow-executor] Error polling test task ${promptId}:`, error);
            throw new Error(`Failed to get status for test task ${promptId}.`);
        }
        
        // Basic progress update based on attempts
        onProgress?.({ status: 'executing' });
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(`Test workflow execution timed out for prompt ID: ${promptId}`);
}

/**
 * Executes a workflow and waits for the result. For use by the editor's "Test Run" ONLY.
 * This is a simplified, blocking version that does not use the task pool.
 * @param {object} workflowJson
 * @param {function} [onProgress]
 * @returns {Promise<object>}
 */
export async function executeWorkflowInComfyUI(workflowJson, onProgress) {
    console.log('[workflow-executor] Submitting workflow for TEST RUN...');
    const promptId = await submitWorkflowToComfyUI(workflowJson);
    console.log(`[workflow-executor] Test workflow submitted with Prompt ID: ${promptId}. Polling for results...`);
    onProgress?.({ status: 'submitted', promptId });
    const outputs = await pollUntilCompleteSimple(promptId, onProgress);
    return outputs;
}

/**
 * The main entry point for the automated workflow execution.
 * It now only submits the task and adds it to the pool.
 * @param {object} options - The execution options.
 */
export async function executeAutomatedWorkflow(options) {
    console.log('[workflow-executor] Starting automated workflow execution with options:', options);
    const { workflowData, prompt, inputImageUrl, width, height, onComplete, messageId, characterName, targetApiUrl } = options;

    try {
        let imageName = null;
        if (inputImageUrl) {
            imageName = await uploadImageToComfyUI(inputImageUrl);
        }

        const modifiedWorkflow = modifyWorkflow(workflowData, { prompt, imageName, width, height });

        const promptId = await submitWorkflowToComfyUI(modifiedWorkflow);
        console.log(`[workflow-executor] Workflow submitted with Prompt ID: ${promptId}. Adding to task pool.`);

        // Add to the pending tasks pool, including the target API URL
        pendingTasks[promptId] = {
            onComplete,
            messageId,
            characterName,
            apiUrl: targetApiUrl, // Store the API URL for this specific task
        };

        // Ensure the central polling is running
        startCentralPolling();

    } catch (error) {
        console.error('[workflow-executor] Error during automated execution:', error);
        onComplete?.(null, error, messageId);
    }
}

// This function remains unchanged as it's a pure utility
async function processAndUploadImage(imageInfo, characterName, apiUrl) {
    const viewUrl = `${apiUrl}/view?filename=${imageInfo.filename}&subfolder=${imageInfo.subfolder || ''}&type=${imageInfo.type || 'output'}`;
    const imageResponse = await fetch(viewUrl);
    if (!imageResponse.ok) {
        throw new Error(`Failed to download image from ComfyUI: ${imageResponse.statusText}`);
    }
    const imageBlob = await imageResponse.blob();
    const base64String = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.replace(/^data:.*,/, ''));
        reader.onerror = reject;
        reader.readAsDataURL(imageBlob);
    });
    const format = imageInfo.filename.split('.').pop();
    const uploadPayload = {
        image: base64String,
        format: format,
        filename: imageInfo.filename,
    };
    if (characterName) {
        uploadPayload.ch_name = characterName;
    }
    const uploadResponse = await fetch('/api/images/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(uploadPayload),
    });
    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Failed to upload image to SillyTavern: ${errorText}`);
    }
    const result = await uploadResponse.json();
    return result.path;
}

// This function also remains unchanged
function modifyWorkflow(workflowData, replacements) {
    const workflow = JSON.parse(JSON.stringify(workflowData));
    function deepReplace(obj) {
        for (const key in obj) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                deepReplace(obj[key]);
            } else if (typeof obj[key] === 'string') {
                let value = obj[key];
                if (value === '%width%' && replacements.width) {
                    obj[key] = replacements.width;
                    continue;
                }
                if (value === '%height%' && replacements.height) {
                    obj[key] = replacements.height;
                    continue;
                }
                if (value === '%seed%') {
                    obj[key] = Math.floor(Math.random() * 1000000000000000);
                    continue;
                }
                if (value.includes('%prompt%') && replacements.prompt) {
                    value = value.replace(/%prompt%/g, replacements.prompt);
                }
                if (value.includes('%image_name%') && replacements.imageName) {
                    value = value.replace(/%image_name%/g, replacements.imageName);
                }
                if (value.includes('%timestamp%')) {
                    value = value.replace(/%timestamp%/g, Date.now());
                }
                obj[key] = value;
            }
        }
    }
    deepReplace(workflow);
    return workflow;
}

// This function also remains unchanged
async function uploadImageToComfyUI(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch image from SillyTavern URL: ${response.statusText}`);
    }
    const imageBlob = await response.blob();
    const formData = new FormData();
    const fileName = imageUrl.split('/').pop();
    formData.append('image', imageBlob, fileName);
    const uploadUrl = `${comfyUIApiBase}/upload/image`;
    const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
    });
    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Failed to upload image to ComfyUI: ${errorText}`);
    }
    const result = await uploadResponse.json();
    if (!result || !result.name) {
        throw new Error('ComfyUI upload response did not contain a filename.');
    }
    return result.name;
}
