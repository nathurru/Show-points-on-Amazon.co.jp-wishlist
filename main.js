// ==UserScript==
// @name         Show points on Amazon.co.jp wishlist
// @version      20.4.0
// @description  Amazon.co.jpの欲しいものリストで、Kindleの商品にポイントを表示しようとします
// @namespace    https://github.com/nathurru/Show-points-on-Amazon.co.jp-wishlist
// @author       Nathurru
// @match        https://www.amazon.co.jp/*/wishlist/*
// @match        https://www.amazon.co.jp/wishlist/*
// @match        https://www.amazon.co.jp/*/dp/*
// @match        https://www.amazon.co.jp/dp/*
// @match        https://www.amazon.co.jp/*/gp/*
// @match        https://www.amazon.co.jp/gp/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @compatible   Chrome
// @license      Apache-2.0
// ==/UserScript==

/**********************************************************************************************************************
 NOTICE:このアプリケーションは国立国会図書館サーチAPI( https://iss.ndl.go.jp/information/api/ )を利用しています
 **********************************************************************************************************************/

(function () {
    'use strict';

    const domParser = new DOMParser();
    const CACHE_LIFETIME = 1209600000;
    const RESCAN_INTERVAL = 10800000;
    const AUTOMATIC_CLEAN_FACTOR = 100;
    const TAX = 0.1;

    const taxIncluded = listPrice => Math.floor(listPrice * (1 + TAX));

    const isNull = value => value === null;
    const isUndefined = value => value === undefined;

    const rate = ((numerator, denominator) => denominator === 0 ? 0 : Math.floor(numerator / denominator * 100));

    const random = max => Math.floor(Math.random() * Math.floor(max));

    const sleep = ms => new Promise((resolve) => setTimeout(resolve, ms));

    const rateColor = rate => {
        if (rate < 20) {
            return {
                color: 'initial',
                bgColor: 'initial',
            };
        } else if (rate < 50) {
            return {
                color: 'initial',
                bgColor: '#F7D44A',
            };
        } else if (rate < 80) {
            return {
                color: '#FFFFFF',
                bgColor: '#FE7E03',
            };
        } else {
            return {
                color: '#FFFFFF',
                bgColor: '#9B1D1E',
            };
        }
    };

    const url = {
        ndl(isbn) {
            return 'https://iss.ndl.go.jp/api/sru?operation=searchRetrieve&recordSchema=dcndl&recordPacking=xml&query=isbn=' + isbn;
        },
        amazon(asin) {
            return 'https://www.amazon.co.jp/dp/' + asin;
        },
    }

    const storage = {
        async save(key, data) {
            console.log('SAVE: ' + key, data);
            GM_setValue(key, JSON.stringify(data));
        },
        load(key) {
            const data = JSON.parse(GM_getValue(key) ?? null);
            console.log('LOAD: ' + key, data);
            return data;
        },
        exists(key) {
            return !isUndefined(GM_getValue(key));
        },
        async delete(key) {
            console.log('DELETE: ' + key);
            GM_deleteValue(key);
        },
        list() {
            return GM_listValues();
        },
        clean() {
            console.log('CLEANING');
            const keys = this.list();
            const now = Date.now();
            for (const key of keys) {
                const data = this.load(key);
                if (now - data.updatedAt > CACHE_LIFETIME) {
                    this.delete(key);
                }
            }
        }
    }

    const storageClean = (() => {
        if (random(AUTOMATIC_CLEAN_FACTOR) === 0) {
            storage.clean();
        }
    })

    const isIsbn = ((isbn) => {
        let c = 0;
        if (isbn.match(/^4[0-9]{8}[0-9X]?$/)) {
            for (let i = 0; i < 9; ++i) {
                c += (10 - i) * Number(isbn.charAt(i));
            }
            c = (11 - c % 11) % 11;
            c = (c === 10) ? 'X' : String(c);
            return c === isbn.charAt(9);
        } else if (isbn.match(/^9784[0-9]{9}?$/)) {
            for (let i = 0; i < 12; ++i) {
                c += Number(isbn.charAt(i)) * ((i % 2) ? 3 : 1);
            }
            c = ((10 - c % 10) % 10);
            return String(c) === isbn.charAt(12);
        } else {
            return false;
        }
    });

    const get = (async (URL) => {
        console.log('GET: ' + URL);

        return new Promise((resolve, reject) => {
            const xhr = window.GM_xmlhttpRequest;
            xhr({
                onabort: reject,
                onerror: reject,
                onload: resolve,
                ontimeout: reject,
                method: 'GET',
                url: URL,
                withCredentials: true,
            });
        });
    });

    const parser = {
        async isKindlePage(dom) {
            return /kindle版$/i.test(dom.querySelector('#title')?.innerText)
        },

        async isbns(dom) {
            let isbns = [];
            const elements = dom.querySelectorAll('li.swatchElement .a-button a');
            for (const element of elements) {
                const m = element.getAttribute("href")?.match(/\/(4[0-9]{8}[0-9X])/);
                if (!isNull(m) && isIsbn(m[1])) {
                    isbns.push(m[1]);
                }
            }

            return isbns;
        },

        async isBought(dom) {
            return /商品を注文/.test(dom.querySelector('#ebooksInstantOrderUpdate_feature_div')?.innerText);
        },

        async asin(dom) {
            return dom.querySelector("input[name='ASIN.0']")?.value;
        },

        async kindlePrice(dom) {
            return parseInt(dom.querySelector(".kindle-price")?.innerText.match(/[0-9,]+/)[0].replace(/,/, ''));
        },

        async pointReturn(dom) {
            let point = 0;

            const elements = dom.querySelectorAll(".swatchElement");
            if (elements.length !== 0) {
                for (const element of elements) {
                    if (!/Kindle/.test(element.innerText)) {
                        continue;
                    }

                    const m = element.innerText.match(/([0-9,]+)pt/);
                    if (!isNull(m)) {
                        point = parseInt(m[1].replace(/,/, ''));
                        break;
                    }
                }
            } else {
                point = parseInt(dom.querySelector(".loyalty-points")?.innerText.match(/[0-9,]+/)[0].replace(/,/, ''));
            }

            return isNaN(point) ? 0 : point;
        },

        async price(xml) {
            const price = parseInt(xml.querySelector("price")?.innerHTML
                .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
                .match(/[0-9]+/)[0]);

            return isNaN(price) ? null : price;
        },

        async itemTitle(dom) {
            return dom.querySelector('a[id^="itemName_"]')?.innerText;
        },

        async isItemProcessed(dom) {
            return dom.classList.contains('SPAW_PROCESSED');
        },

        async isKindleItem(dom) {
            return /Kindle版/.test(dom.querySelector('span[id^="item-byline-"]')?.innerText);
        },

        async itemAsin(dom) {
            return JSON.parse(dom.querySelector('.price-section')?.getAttribute('data-item-prime-info') ?? null)?.asin
        }


    }

    const lowPriceBook = (async (isbns) => Promise.all(isbns.map(async (isbn) => {
            const request = await get(url.ndl(isbn));
            return {
                isbn: isbn,
                price: await parser.price(request.responseXML),
            };
        })).then((prices) => {
            return prices.reduce((a, b) => a.price < b.price ? a : b);
        })
    );

    const itemPage = {
        async itemInfo(dom) {
            if (!parser.isKindlePage(dom)) {
                return null;
            }

            const asin = await parser.asin(dom);
            console.log('ASIN: ' + asin);
            if (isUndefined(asin)) {
                throw new Error('ASIN NOT FOUND');
            }

            const data = storage.load(asin);

            return Promise.all([
                this.bookInfo(dom, data),
                this.kindleInfo(dom, data),
            ]).then(([bookInfo, kindleInfo]) => {
                return {
                    asin: asin,
                    isbn: bookInfo.isbn,
                    paperPrice: bookInfo.price,
                    kindlePrice: kindleInfo.price,
                    pointReturn: kindleInfo.point,
                    isBought: kindleInfo.isBought,
                    updatedAt: Date.now(),
                };
            });
        },
        async kindleInfo(dom, data) {
            return Promise.all([
                parser.kindlePrice(dom),
                parser.pointReturn(dom),
                parser.isBought(dom),
            ]).then(([kindlePrice, pointReturn, isBought]) => {
                return {
                    price: kindlePrice,
                    point: pointReturn,
                    isBought: isBought,
                };
            })
        },

        async bookInfo(dom, data) {
            if (!isNull(data)) {
                console.log('USE CACHE: ' + data.asin)
                return {
                    isbn: data.isbn,
                    price: data.paperPrice,
                }
            }

            const isbns = await parser.isbns(dom);
            console.log('ISBN: ', isbns);

            if (isbns.length === 0) {
                return {
                    isbn: null,
                    price: null,
                };
            }

            const book = await lowPriceBook(isbns);
            console.log('LOW: ', book)

            return {
                isbn: book.isbn,
                price: book.price,
            }
        },

        async addPaperPrice(dom, paperPrice, kindlePrice) {
            if (isNull(paperPrice) || paperPrice === 0 || !isNull(dom.querySelector('.print-list-price'))) {
                return;
            }

            paperPrice = taxIncluded(paperPrice);
            const off = paperPrice - kindlePrice;
            const offRate = rate(off, paperPrice);

            let html = '<tr class="print-list-price">' +
                '<td class="a-span1 a-color-secondary a-size-small a-text-left a-nowrap">' +
                '    紙の本の価格：' +
                '</td>' +
                '<td class="a-color-base a-align-bottom a-text-strike">' +
                '    ￥' + paperPrice +
                '</td>' +
                '</tr>' +
                '<tr class="savings">' +
                '<td class="a-span1 a-color-secondary a-text-left a-nowrap">' +
                '    割引:' +
                '</td>' +
                '<td class="a-color-base a-align-bottom">' +
                '    ￥' + off + '(' + offRate + '%)' +
                '</td>' +
                '</tr>' +
                '<tr>' +
                '<td colspan="2" class="a-span1 a-color-secondary">' +
                '    <hr class="a-spacing-small a-spacing-top-small a-divider-normal">' +
                '</td>' +
                '</tr>';

            const element = dom.querySelector('#buybox tbody') ?? dom.querySelector("#buyOneClick tbody");

            if (!isNull(element)) {
                element.insertAdjacentHTML('afterbegin', html);
            }
        },

        async addPoint(dom, price, point) {
            if (!isNull(dom.querySelector('.loyalty-points')) || point === 0) {
                return;
            }

            const pointRate = rate(point, price);

            const html = '<tr class="loyalty-points">' +
                '<td class="a-span6 a-color-secondary a-size-base a-text-left">' +
                '  <div class="a-section a-spacing-top-small">獲得ポイント:</div>' +
                '</td>' +
                '<td class="a-align-bottom">' +
                '  <div class="a-section a-spacing-top-small">' +
                '    <span>' +
                '      <span class="a-size-base a-color-price a-text-bold">' + point + 'ポイント</span>' +
                '        <span class="a-size-base a-color-price">(' + pointRate + '%)</span>' +
                '      </span>' +
                '    </div>' +
                '  </td>' +
                '</tr>';

            const element = dom.querySelector('#buybox tbody') ?? dom.querySelector("#buyOneClick tbody");

            if (!isNull(element)) {
                element.insertAdjacentHTML('beforeend', html);
            }
        },

        async emphasisPrice(dom) {
            const elements = dom.querySelectorAll("tr.kindle-price td")

            const label = dom.querySelector("tr.kindle-price td")
            const price = dom.querySelector("tr.kindle-price span");

            if (isNull(label) || isNull(price)) {
                return;
            }

            label.classList.remove('a-color-secondary', 'a-size-small');
            label.classList.add('a-color-price', 'a-text-bold', 'a-size-medium');

            price.classList.remove('a-color-secondary', 'a-size-small');
            price.classList.add('a-color-price', 'a-text-bold', 'a-size-medium');
        }
    };


    const wishlistPage = {
        discoveries: [],
        observer: null,

        async push(nodes) {
            for (const dom of Array.from(nodes).filter((element, index) => element.nodeName === "LI")) {
                const title = await parser.itemTitle(dom);
                const asin = await parser.itemAsin(dom);
                if (!await parser.isKindleItem(dom) || isUndefined(asin)) {
                    continue;
                }

                console.log('PUSH:[' + asin + ']' + title);
                this.processStart(dom);
                this.discoveries.push(dom);
            }
        },

        async initialize(dom) {
            await get('https://www.amazon.co.jp/gp/product/black-curtain-redirect.html');
            await this.push(dom.querySelectorAll(".g-item-sortable"));

            this.observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === "childList") {
                        this.push(mutation.addedNodes);
                    }
                });
            });
            this.observer.observe(document.querySelector("#g-items"), {
                childList: true,
            });
            this.run();
        },

        async run() {
            let runCount = 0;
            let sleepCount = 0;
            while (sleepCount < 120) {
                while (this.discoveries.length > 0) {
                    sleepCount = 0;
                    if (runCount < 5) {
                        ++runCount;
                        this.listItem(this.discoveries.shift()).finally(() => --runCount);
                    } else {
                        await sleep(100);
                    }
                }
                ++sleepCount;
                await sleep(1000);
            }
            console.log('OBSERVER DISCONNECT');
            this.observer.disconnect();
        },

        async listItem(dom) {
            const title = await parser.itemTitle(dom);
            const asin = await parser.itemAsin(dom);

            console.log('ITEM INFO:[' + asin + ']' + title);

            if (await parser.isItemProcessed(dom)) {
                await this.processEnd(dom);
                return;
            }

            let data;
            if (this.isCacheActive(asin)) {
                console.log('CACHE LOAD:' + title);
                data = storage.load(asin);
            } else {
                console.log('CACHE EXPIRE:' + title);
                const request = await get(url.amazon(asin));
                data = await itemPage.itemInfo(domParser.parseFromString(request.response, 'text/html'));
                console.log('DATA: ' + title, data);
                storage.save(data.asin, data);
            }

            await this.viewPrice(dom, data);
            await this.processEnd(dom);

            console.log('END:[' + asin + ']' + title);
        },

        isCacheActive(asin) {
            if (!storage.exists(asin)) {
                return false;
            } else {
                return Date.now() - storage.load(asin).updatedAt <= RESCAN_INTERVAL;
            }
        },

        async processStart(dom) {
            const element = dom.querySelector('div[id^="itemInfo_"]');
            if (!isNull(element)) {
                element.insertAdjacentHTML('afterbegin', '<div class="a-row SPAW_PROCESSING" style="color:#EE0077">処理中</div>');
            }
        },

        async processEnd(dom) {
            dom.querySelector('.SPAW_PROCESSING').remove();
            dom.classList.add("SPAW_PROCESSED");
        },

        async viewPrice(dom, data) {
            const paperPrice = taxIncluded(data.paperPrice);
            const kindlePrice = data.kindlePrice;
            const off = paperPrice - kindlePrice;
            const offRate = rate(off, paperPrice)
            const offRateColor = rateColor(offRate);
            const point = data.pointReturn;
            const pointRate = rate(point, kindlePrice)
            const pointRateColor = rateColor(pointRate);

            let html = '<div>';
            if (!isNull(data.paperPrice)) {
                html += '<div>' +
                    '<span class="a-price-symbol">紙の本:￥</span>' +
                    '<span class="a-price-whole">' + paperPrice + '</span>' +
                    '</div>';
            }
            html += '<div>' +
                '<span class="a-price-symbol a-color-price a-size-large">価格:￥</span>' +
                '<span class="a-price-whole a-color-price a-size-large">' + kindlePrice + '</span>' +
                '</div>';
            if (!isNull(data.paperPrice)) {
                html += '<div style="color:' + offRateColor.color + ';background-color:' + offRateColor.bgColor + '">' +
                    '<span class="a-price-symbol">割り引き:</span>' +
                    '<span class="a-price-whole">' + off + '円( ' + offRate + '%割引)</span>' +
                    '</div>';
            }
            html += '<div style="color:' + pointRateColor.color + ';background-color:' + pointRateColor.bgColor + '">' +
                '<span class="a-price-symbol">ポイント:</span>' +
                '<span class="a-price-whole">' + point + 'ポイント(' + pointRate + '%還元)</span>' +
                '</div>';
            html += '</div>';

            dom.querySelector(".wl-price-ppu-delivery-badge-row").innerHTML = html;
        },
    }

    const oldVersionCacheClear = (() => {
        for (const key in localStorage) {
            if (/^SPAW_/.test(key)) {
                localStorage.removeItem(key);
            }
        }
    });

    const main = (async () => {
        const url = location.href;
        const dom = document

        oldVersionCacheClear();
        storageClean();

        if (/\/(dp|gp)\//.test(url) && await parser.isKindlePage(dom)) {
            await itemPage.itemInfo(dom).then((data) => {
                storage.save(data.asin, data);
                itemPage.addPaperPrice(dom, data.paperPrice, data.kindlePrice);
                itemPage.addPoint(dom, data.kindlePrice, data.pointReturn);
                itemPage.emphasisPrice(dom);
            });

        } else if (/\/wishlist\//.test(url)) {
            await wishlistPage.initialize(dom);
        }
    });

    main();
})();
