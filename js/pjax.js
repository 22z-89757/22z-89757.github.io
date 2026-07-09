/**
 * PJAX — 无缝页面切换，保持全局音乐播放器持续播放
 *
 * 工作原理：
 * 1. 拦截所有同域内部链接点击
 * 2. 用 fetch 获取目标页面
 * 3. 提取目标页面的 #pjax-content 并替换当前内容
 * 4. 用 history.pushState 更新地址栏
 * 5. 重新初始化页面脚本（AOS、masonry、lightGallery 等）
 */

(function () {
    'use strict';

    var CONTENT_SELECTOR = '#pjax-content';
    var currentUrl = location.href;

    // 新会话检测：每次重新打开网站都从首页开始
    if (!sessionStorage.getItem('pjax-session')) {
        sessionStorage.setItem('pjax-session', '1');
        if (location.pathname !== '/' && location.pathname !== '/index.html') {
            // 替换当前历史记录条目，避免产生多余的后退记录
            history.replaceState(null, '', '/');
            location.replace('/');
            return;
        }
    }

    /**
     * 判断链接是否应该被 PJAX 拦截
     */
    function shouldIntercept(link) {
        // 同源检查
        if (link.hostname !== location.hostname) return false;
        // 新标签页打开
        if (link.target === '_blank') return false;
        // 下载链接
        if (link.download && link.download.length > 0) return false;
        // 页内锚点
        var href = link.getAttribute('href');
        if (!href || href === '#') return false;
        if (href.startsWith('#')) return false;
        // admin / 特殊协议
        if (/^(mailto:|javascript:|data:|tel:)/.test(href)) return false;
        // RSS / feed
        if (/\.xml$/.test(href)) return false;
        return true;
    }

    /**
     * 显示加载进度条动画
     */
    function showLoading() {
        var bar = document.querySelector('.progress-bar');
        if (bar) {
            bar.style.transition = 'none';
            bar.style.width = '0%';
        }
    }

    function finishLoading() {
        var bar = document.querySelector('.progress-bar');
        if (bar) {
            bar.style.transition = 'width 0.4s ease';
            bar.style.width = '100%';
            setTimeout(function () {
                bar.style.transition = 'none';
                bar.style.width = '0%';
            }, 450);
        }
    }

    /**
     * 按顺序执行脚本：外部脚本加载完后再执行后续内联脚本，
     * 保证依赖关系正确（如 echarts.js 加载完后再执行 echarts.init()）。
     * 已加载过的外部脚本跳过，避免重复下载。
     */
    function executeScripts(container) {
        var scripts = Array.from(container.querySelectorAll('script'));
        var loadedScripts = {}; // 记录已加载的外部脚本 URL

        function processNext(index) {
            if (index >= scripts.length) return;

            var oldScript = scripts[index];
            var newScript = document.createElement('script');

            // 复制属性
            Array.from(oldScript.attributes).forEach(function (attr) {
                newScript.setAttribute(attr.name, attr.value);
            });

            // 外部脚本（有 src 属性）
            if (oldScript.src) {
                // 已加载过则跳过
                if (loadedScripts[oldScript.src]) {
                    if (oldScript.parentNode) oldScript.parentNode.removeChild(oldScript);
                    processNext(index + 1);
                    return;
                }
                loadedScripts[oldScript.src] = true;
                newScript.onload = function () { processNext(index + 1); };
                newScript.onerror = function () { processNext(index + 1); };
            } else {
                // 内联脚本：直接复制内容后继续下一个
                newScript.textContent = oldScript.textContent;
            }

            // 替换旧脚本节点
            if (oldScript.parentNode) {
                oldScript.parentNode.replaceChild(newScript, oldScript);
            }

            // 内联脚本无需等待，继续处理下一个
            if (!oldScript.src) {
                processNext(index + 1);
            }
        }

        processNext(0);
    }

    /**
     * 重新初始化页面脚本（内容替换后调用）
     */
    function reinitPage() {
        // 修复 footer 位置
        var content = document.querySelector('.content');
        if (content) {
            content.style.minHeight = (window.innerHeight - 165) + 'px';
        }

        // 重新初始化 AOS 动画
        if (typeof AOS !== 'undefined') {
            AOS.init({
                easing: 'ease-in-out-sine',
                duration: 700,
                delay: 100
            });
        }

        if (typeof $ !== 'undefined') {
            // 瀑布流布局
            var articlesEl = $('#articles');
            if (articlesEl.length) {
                articlesEl.masonry({
                    itemSelector: '.article'
                });
            }

            // lightGallery 图片预览
            if ($.fn.lightGallery) {
                $('#articleContent, #myGallery').lightGallery({
                    selector: '.img-item',
                    subHtmlSelectorRelative: true
                });
            }

            // 文章内容中的外部链接
            $('#articleContent a').attr('target', '_blank');

            // Materialize 组件
            if ($.fn.sidenav) {
                $('.sidenav').sidenav();
            }
            if ($.fn.modal) {
                $('.modal').modal();
            }
            if ($.fn.tooltip) {
                $('.tooltipped').tooltip();
            }

            // 文章卡片 hover 效果
            $('article .article').hover(
                function () { $(this).addClass('animated pulse'); },
                function () { $(this).removeClass('animated pulse'); }
            );

            // 修复文章卡片宽度
            fixPostCardWidth('navContainer');
            fixPostCardWidth('artDetail', 'prenext-posts');

            // 代码块功能
            if (typeof codeBlockFunction !== 'undefined') {
                codeBlockFunction();
            }
            if (typeof codeCopy !== 'undefined') {
                codeCopy();
            }
        }

        // 滚动进度条
        var progressElement = document.querySelector('.progress-bar');
        if (progressElement && typeof ScrollProgress !== 'undefined') {
            new ScrollProgress(function (x, y) {
                progressElement.style.width = y * 100 + '%';
            });
        }

        // 触发自定义事件，供其他脚本使用
        document.dispatchEvent(new CustomEvent('pjax:complete'));
    }

    function fixPostCardWidth(srcId, targetId) {
        var srcDiv = $('#' + srcId);
        if (srcDiv.length === 0) return;
        var w = srcDiv.width();
        if (w >= 450) {
            w = w + 21;
        } else if (w >= 350 && w < 450) {
            w = w + 18;
        } else if (w >= 300 && w < 350) {
            w = w + 16;
        } else {
            w = w + 14;
        }
        $('#' + targetId).width(w);
    }

    /**
     * 加载并替换页面内容
     */
    function loadPage(url, pushHistory) {
        if (pushHistory === undefined) pushHistory = true;

        showLoading();

        fetch(url, { credentials: 'same-origin' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.text();
            })
            .then(function (html) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(html, 'text/html');

                // 获取新页面的内容
                var newContainer = doc.querySelector(CONTENT_SELECTOR);
                var currentContainer = document.querySelector(CONTENT_SELECTOR);

                if (!newContainer || !currentContainer) {
                    throw new Error('Missing #pjax-content container');
                }

                // 更新页面标题
                document.title = doc.title;

                // 替换内容
                currentContainer.innerHTML = newContainer.innerHTML;

                // 执行新内容中的内联脚本
                executeScripts(currentContainer);

                // 更新 URL
                if (pushHistory) {
                    history.pushState({ url: url }, '', url);
                    currentUrl = url;
                }

                // 滚动到顶部
                window.scrollTo(0, 0);

                // 重新初始化页面
                reinitPage();
                finishLoading();
            })
            .catch(function (err) {
                console.warn('PJAX failed, falling back to full page load:', err.message);
                // 失败时回退到完整页面加载
                location.href = url;
            });
    }

    // --- 事件监听 ---

    // 拦截内部链接点击
    document.addEventListener('click', function (e) {
        var link = e.target.closest('a');
        if (!link) return;
        if (!shouldIntercept(link)) return;

        e.preventDefault();
        loadPage(link.href);
    });

    // 处理浏览器前进/后退
    window.addEventListener('popstate', function (e) {
        if (e.state && e.state.url) {
            loadPage(e.state.url, false);
        }
    });

})();
