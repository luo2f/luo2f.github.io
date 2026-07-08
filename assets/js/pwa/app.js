---
layout: compress
permalink: '/app.js'
---

/* PWA Update Handler with Enhanced Notification */
const $notification = $('#notification');
const $btnRefresh = $('#notification .toast-body>button');

/* 版本检测配置 */
const VERSION_CHECK_INTERVAL = 30 * 60 * 1000; // 每30分钟检测一次
const VERSION_KEY = 'chirpy-blog-version';

/* 创建更新提示模态框 */
function createUpdateModal() {
    // 移除已存在的模态框
    $('#update-modal').remove();
    
    const modalHtml = `
        <div id="update-modal" class="modal fade" tabindex="-1" aria-labelledby="update-modal-label" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title" id="update-modal-label">
                            <i class="fas fa-sync-alt me-2"></i>发现新版本
                        </h5>
                        <button type="button" class="btn-close btn-close-dark" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3">博客已更新到新版本，建议刷新页面获取最新内容。</p>
                        <div class="d-flex align-items-center text-muted small">
                            <i class="fas fa-info-circle me-2"></i>
                            <span>更新将清除本地缓存并重新加载页面</span>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">稍后更新</button>
                        <button type="button" class="btn btn-warning text-dark" id="btn-update-now">
                            <i class="fas fa-refresh me-1"></i>立即更新
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    $('body').append(modalHtml);
    return new bootstrap.Modal(document.getElementById('update-modal'));
}

/* 清空所有缓存 */
async function clearAllCaches() {
    if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        console.log('[PWA] All caches cleared');
    }
}

/* 检测版本更新 */
async function checkForUpdate() {
    try {
        // 添加时间戳避免缓存
        const response = await fetch('/assets/js/data/swconf.js?t=' + Date.now(), {
            cache: 'no-store'
        });
        
        if (response.ok) {
            const text = await response.text();
            // 提取版本标识（时间戳）
            const versionMatch = text.match(/chirpy-(\d+)/);
            if (versionMatch) {
                const currentVersion = versionMatch[1];
                const storedVersion = localStorage.getItem(VERSION_KEY);
                
                if (storedVersion && storedVersion !== currentVersion) {
                    console.log('[PWA] New version detected:', currentVersion);
                    showUpdateNotification();
                }
                
                localStorage.setItem(VERSION_KEY, currentVersion);
            }
        }
    } catch (error) {
        console.log('[PWA] Version check failed:', error);
    }
}

/* 显示更新通知 */
function showUpdateNotification() {
    // 使用原生 toast（兼容主题）
    if ($notification.length) {
        $notification.toast('show');
    }
    
    // 同时显示醒目的模态框
    const modal = createUpdateModal();
    modal.show();
    
    // 绑定立即更新按钮
    $('#btn-update-now').off('click').on('click', async function() {
        modal.hide();
        await clearAllCaches();
        window.location.reload();
    });
}

/* Service Worker 注册 */
if ('serviceWorker' in navigator) {
    /* Registering Service Worker */
    navigator.serviceWorker.register('{{ "/sw.js" | relative_url }}')
        .then(registration => {
            console.log('[PWA] Service Worker registered');
            
            /* in case the user ignores the notification */
            if (registration.waiting) {
                showUpdateNotification();
            }

            registration.addEventListener('updatefound', () => {
                registration.installing.addEventListener('statechange', () => {
                    if (registration.waiting) {
                        if (navigator.serviceWorker.controller) {
                            showUpdateNotification();
                        }
                    }
                });
            });

            $btnRefresh.click(async () => {
                if (registration.waiting) {
                    registration.waiting.postMessage('SKIP_WAITING');
                }
                await clearAllCaches();
                $notification.toast('hide');
            });
        });

    let refreshing = false;

    /* Detect controller change and refresh all the opened tabs */
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
        if (!refreshing) {
            await clearAllCaches();
            window.location.reload();
            refreshing = true;
        }
    });
}

/* 页面可见时检测更新 */
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkForUpdate();
    }
});

/* 定时检测更新 */
setInterval(checkForUpdate, VERSION_CHECK_INTERVAL);

/* 页面加载后首次检测 */
setTimeout(checkForUpdate, 5000);