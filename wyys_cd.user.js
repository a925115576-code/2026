// ==UserScript==
// @name         CD - 售价输入自动填充（单窗口更新版）
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  修复更新时弹出两个窗口的问题，优化更新跳转逻辑
// @author       定制
// @match        https://www.51selling.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/a925115576-code/2026/refs/heads/main/wyys_cd.user.js
// @downloadURL  https://raw.githubusercontent.com/a925115576-code/2026/refs/heads/main/wyys_cd.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        getEnable: () => GM_getValue('enableAutoFill', '1') === '1',
        getPrefix: () => GM_getValue('skuPrefix', 'JACK'),
        vatTargetValue: 20,
        currentVersion: '5.1',
        // 核心：直接使用原始文件地址
        updateUrl: 'https://raw.githubusercontent.com/a925115576-code/2026/refs/heads/main/wyys_cd.user.js',
        clearFields: [
            'ProductPackagingValue',
            'Standard-ShippingCharges','Standard-AdditionalShippingCharges',
            'Registered-ShippingCharges','Registered-AdditionalShippingCharges',
            'MondialRelay-ShippingCharges','MondialRelay-AdditionalShippingCharges',
            'RelaisColis-ShippingCharges','RelaisColis-AdditionalShippingCharges',
            'SoColissimo-ShippingCharges','SoColissimo-AdditionalShippingCharges',
        ],
        zeroFields: ['EcoPart','DeaTax','Tracked-ShippingCharges','Tracked-AdditionalShippingCharges'],
        selectors: {
            priceInput: 'input[name="variant-Price-01"]',
            strikedPrice: 'input[name="variant-StrikedPrice-01"]',
            minPrice: 'input[name="variant-MinimumPriceForPriceAlignment-01"]',
            stock: 'input[name="variant-Stock-01"]',
            skuInput: 'input[name="variant-SellerProductId-01"]',
            vatInput: '#Vat',
            genCodeBtn: '#btn-gencode',
            autoEanBtn: 'a[onclick="autoEanCode();"]',
            eanInput: 'input[name="variant-Ean-01"]',
            productCondition: '#ProductCondition',
            sourceUrl: 'input[name="SourceUrl-0"]',
        }
    };

    let isExecuting = false;
    let isUpdating = false;
    let lastPrice = '';
    let menuIds = [];

    function toast(msg) {
        const oldToast = document.getElementById('gm-single-toast');
        if (oldToast) oldToast.remove();
        const div = document.createElement('div');
        div.id = 'gm-single-toast';
        div.textContent = msg;
        div.style.cssText = `
            position: fixed; left: 50%; top: 35%; transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.85); color: #fff; padding: 14px 28px; border-radius: 10px;
            z-index: 9999999; font-size: 15px; font-weight: 500; pointer-events: none;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4); transition: opacity 0.5s ease, transform 0.5s ease;
            border: 1px solid rgba(255,255,255,0.1);
        `;
        document.body.appendChild(div);
        setTimeout(() => {
            if(div) {
                div.style.opacity = '0';
                div.style.transform = 'translate(-50%, -60%)';
                setTimeout(() => div.remove(), 500);
            }
        }, 2500);
    }

    function refreshMenu() {
        if (window.self !== window.top) return;
        menuIds.forEach(id => GM_unregisterMenuCommand(id));
        menuIds = [];
        const isEnabled = CONFIG.getEnable();
        const stateId = GM_registerMenuCommand(isEnabled ? "✅ 自动填充：已开启" : "❌ 自动填充：已关闭", () => {
            GM_setValue('enableAutoFill', isEnabled ? '0' : '1');
            toast(isEnabled ? "🔴 自动填充已关闭" : "🟢 自动填充已开启");
            refreshMenu();
        });
        menuIds.push(stateId,
            GM_registerMenuCommand("📛 设置 SKU 前缀", showPrefixInput),
            GM_registerMenuCommand("🔄 检查脚本更新", checkUpdate)
        );
    }

    function showPrefixInput() {
        if (window.self !== window.top || document.getElementById('sku-prefix-panel-mask')) return;
        const mask = document.createElement('div');
        mask.id = 'sku-prefix-panel-mask';
        mask.style.cssText = `position: fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999998;`;
        const box = document.createElement('div');
        box.style.cssText = `
            position: fixed; left:50%; top:50%; transform:translate(-50%,-50%);
            width:340px; background:#fff; border-radius:8px; padding:20px;
            z-index:9999999; box-shadow:0 4px 20px rgba(0,0,0,0.2);
        `;
        box.innerHTML = `
            <div style="font-size:16px; margin-bottom:12px; font-weight:bold;">设置 SKU 前缀</div>
            <input type="text" id="prefix_input_val" value="${CONFIG.getPrefix()}"
                style="width:100%; padding:10px; border:1px solid #ddd; border-radius:4px; outline:none;">
            <div style="display:flex; gap:10px; margin-top:15px;">
                <button id="prefix_cancel" style="flex:1; padding:10px; cursor:pointer; border:none; border-radius:4px; background:#f1f1f1;">取消</button>
                <button id="prefix_confirm" style="flex:1; padding:10px; cursor:pointer; border:none; border-radius:4px; background:#409eff; color:#fff;">保存</button>
            </div>
        `;
        document.body.appendChild(mask);
        document.body.appendChild(box);
        const close = () => { mask.remove(); box.remove(); };
        box.querySelector('#prefix_cancel').onclick = close;
        box.querySelector('#prefix_confirm').onclick = () => {
            const v = box.querySelector('#prefix_input_val').value.trim();
            if (v) { GM_setValue('skuPrefix', v); toast(`✅ 前缀已保存：${v}`); }
            close();
        };
    }

    function checkUpdate() {
        // 严格限制：只有最顶层窗口可以执行更新逻辑
        if (window.self !== window.top || isUpdating) return;

        isUpdating = true;
        toast('🔍 正在检查更新...');

        // 加上时间戳击穿 GitHub 缓存
        const requestUrl = CONFIG.updateUrl + '?t=' + new Date().getTime();

        GM_xmlhttpRequest({
            method: 'GET',
            url: requestUrl,
            nocache: true,
            timeout: 10000,
            onload: (res) => {
                const text = res.responseText;
                const vMatch = text.match(/@version\s+([0-9.]+)/i);

                if (vMatch) {
                    const onlineVer = vMatch[1].trim();
                    const currentVer = CONFIG.currentVersion;

                    if (parseFloat(onlineVer) > parseFloat(currentVer)) {
                        toast(`✅ 发现新版本：${onlineVer}，正在打开安装页面...`);
                        // 修复点：直接打开 Raw 链接，不要加任何前缀，让油猴自动拦截
                        setTimeout(() => {
                            GM_openInTab(CONFIG.updateUrl, { active: true, insert: true, setParent: true });
                        }, 1200);
                    } else {
                        toast(`✅ 当前已是最新版 (v${currentVer})`);
                    }
                } else {
                    toast('❌ 无法解析线上版本');
                }
                setTimeout(() => { isUpdating = false; }, 3000);
            },
            onerror: () => {
                toast('❌ 检查失败，请检查网络');
                isUpdating = false;
            },
            ontimeout: () => {
                toast('❌ 请求超时');
                isUpdating = false;
            }
        });
    }

    const Utils = {
        setInput(el, val) {
            if(!el) return;
            el.value = val;
            el.dispatchEvent(new Event('input', {bubbles:true}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
        },
        clearInput(el) { this.setInput(el, ''); },
        zeroInput(el) { this.setInput(el, '0'); },
        getTodayMMDD() { const d = new Date(); return String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0'); },
        async fetchSkuFromUrl(url) {
            return new Promise(resolve => {
                const m = url?.match(/product_id=(\d+)/);
                if(!m || !m[1]) return resolve(null);
                GM_xmlhttpRequest({
                    method:'GET', url:`https://www.gigab2b.com/index.php?route=/product/info/info/baseInfos&product_id=${m[1]}`, timeout:8000,
                    onload:r=>{try{resolve(JSON.parse(r.responseText)?.data?.product_info?.sku||null)}catch{resolve(null)}},
                    onerror:()=>resolve(null)
                });
            });
        }
    };

    function autoMaxWindow() {
        const layer = document.querySelector('.layui-layer-iframe');
        const btn = document.querySelector('.layui-layer-max');
        if(layer && btn && !layer.dataset.maxed) { btn.click(); layer.dataset.maxed = 'true'; }
    }

    async function doFill() {
        if (!CONFIG.getEnable() || isExecuting) return;
        const priceEl = document.querySelector(CONFIG.selectors.priceInput);
        if (!priceEl) return;
        const val = priceEl.value.trim();
        const price = parseFloat(val);
        if (!val || isNaN(price) || price <= 0 || val === lastPrice) return;

        isExecuting = true;
        lastPrice = val;

        try {
            autoMaxWindow();
            document.querySelector(CONFIG.selectors.genCodeBtn)?.click();
            const eanInput = document.querySelector(CONFIG.selectors.eanInput);
            if (eanInput) eanInput.value = '';
            setTimeout(() => { document.querySelector(CONFIG.selectors.autoEanBtn)?.click(); }, 100);

            CONFIG.zeroFields.forEach(id => Utils.zeroInput(document.getElementById(id)));
            CONFIG.clearFields.forEach(id => Utils.clearInput(document.getElementById(id)));

            Utils.setInput(document.querySelector(CONFIG.selectors.vatInput), CONFIG.vatTargetValue);
            Utils.setInput(document.querySelector(CONFIG.selectors.strikedPrice), (price / 0.7).toFixed(2));
            Utils.setInput(document.querySelector(CONFIG.selectors.minPrice), (price * 0.98).toFixed(2));
            Utils.setInput(document.querySelector(CONFIG.selectors.stock), Math.floor(Math.random() * 191) + 10);

            const sourceUrl = document.querySelector(CONFIG.selectors.sourceUrl)?.value.trim();
            const sku = await Utils.fetchSkuFromUrl(sourceUrl);
            if (sku) {
                const finalSku = `${CONFIG.getPrefix()}${Utils.getTodayMMDD()}\\${sku}`;
                Utils.setInput(document.querySelector(CONFIG.selectors.skuInput), finalSku);
            }
            toast("🚀 自动填充已完成！");
        } catch (e) {
            console.error('Fill Error:', e);
        } finally {
            setTimeout(() => { isExecuting = false; }, 500);
        }
    }

    function startMonitor() {
        setInterval(() => {
            const el = document.querySelector(CONFIG.selectors.priceInput);
            if (el && !el.dataset.bound) {
                el.dataset.bound = 'true';
                ['input', 'change', 'paste'].forEach(ev => el.addEventListener(ev, doFill));
            }
            autoMaxWindow();
        }, 300);
    }

    refreshMenu();
    startMonitor();
})();
