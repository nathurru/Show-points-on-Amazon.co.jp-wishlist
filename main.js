// ==UserScript==
// @name         Show points on Amazon.co.jp wishlist
// @version      20.10.0
// @description  Amazon.co.jpの欲しいものリストと検索ページで、Kindleの商品にポイントを表示しようとします
// @namespace    https://greasyfork.org/ja/users/165645-agn5e3
// @author       Nathurru
// @match        https://www.amazon.co.jp/*/wishlist/*
// @match        https://www.amazon.co.jp/wishlist/*
// @match        https://www.amazon.co.jp/*/dp/*
// @match        https://www.amazon.co.jp/dp/*
// @match        https://www.amazon.co.jp/*/gp/*
// @match        https://www.amazon.co.jp/gp/*
// @match        https://www.amazon.co.jp/s*
// @match        https://www.amazon.co.jp/b*
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

    const COMMERCIAL_PUBLISHERS = [
        'DeNA',
        'KADOKAWA',
        'SBクリエイティブ',
        'TOブックス',
        'アース・スター エンターテイメント',
        'あさ出版',
        'アスコム',
        'インプレス',
        'エブリスタ ',
        'オーム社',
        'かんき出版',
        'コミックハウス',
        'サンマーク出版',
        'ジーオーティー',
        'スクウェア・エニックス',
        'ダイヤモンド社',
        'ドワンゴ',
        'フレックスコミックス',
        'ぶんか社',
        'マール社',
        'マイクロマガジン社',
        'マイナビ出版',
        'マガジンハウス',
        'マッグガーデン',
        'ワニブックス',
        '一迅社',
        '学研プラス',
        '技術評論社',
        '近代科学社',
        '幻冬舎',
        '講談社',
        '主婦と生活社',
        '主婦の友社',
        '秋田書店',
        '集英社',
        '小学館',
        '少年画報社',
        '新書館',
        '新潮社',
        '双葉社',
        '早川書房',
        '竹書房',
        '筑摩書房',
        '中央公論新社',
        '朝日新聞出版',
        '東京書籍',
        '東洋経済新報社',
        '徳間書店',
        '日経BP',
        '日本文芸社',
        '白泉社',
        '扶桑社',
        '文藝春秋',
        '宝島社',
        '芳文社',
        '翔泳社',
        '東京創元社',
        '三栄',
    ];

    const taxIncluded = listPrice => Math.floor(listPrice * (1 + TAX));

    const isNull = value => value === null;
    const isUndefined = value => value === undefined;

    const rate = ((numerator, denominator) => denominator === 0 ? 0 : Math.ceil(numerator / denominator * 100));

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
        ndlPublisher(publisher) {
            return 'https://iss.ndl.go.jp/api/sru?operation=searchRetrieve&recordSchema=dcndl&recordPacking=xml&maximumRecords=1&mediatype=1&query=publisher=' + publisher;
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
            const data = GM_getValue(key);
            if (isUndefined(data)) {
                return null;
            }
            console.log('LOAD: ' + key, data);
            return JSON.parse(data);
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
                if (key === 'SETTINGS' || key === 'PUBLISHERS') {
                    continue;
                }
                const data = this.load(key);
                if (now - data.updatedAt > CACHE_LIFETIME) {
                    this.delete(key);
                }
            }
        },
        isCacheActive(asin) {
            if (!storage.exists(asin)) {
                return false;
            } else {
                return Date.now() - storage.load(asin).updatedAt <= RESCAN_INTERVAL;
            }
        },
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
            const element = dom.querySelector('#title');
            if (isNull(element)) {
                return false;
            }
            return /kindle版/i.test(element.innerText)
        },

        async isbns(dom) {
            let isbns = [];
            const elements = dom.querySelectorAll('li.swatchElement .a-button a');
            for (const element of elements) {
                const href = element.getAttribute("href");
                if (isNull(href)) {
                    continue;
                }
                const m = href.match(/\/(4[0-9]{8}[0-9X])/);
                if (!isNull(m) && isIsbn(m[1])) {
                    isbns.push(m[1]);
                }
            }

            return isbns;
        },

        async isBought(dom) {
            const element = dom.querySelector('#ebooksInstantOrderUpdate_feature_div');
            if (isNull(element)) {
                return false;
            }
            return /商品を注文/.test(element.innerText);
        },

        async isKdp(dom) {
            const elements = dom.querySelectorAll("#detailBullets_feature_div .a-list-item");

            for (const element of elements) {
                if (/出版社/.test(element.innerText)) {
                    const m = element.querySelector('span:nth-child(2)').innerText.match(/([^\(（\/]+)/);
                    if (isNull(m)) {
                        return true;
                    }
                    const publisher = m[1];
                    console.log('publisher:' + publisher);

                    const findIndex = COMMERCIAL_PUBLISHERS.findIndex(item => new RegExp(item).test(publisher));
                    if (findIndex !== -1) {
                        return false;
                    }

                    let publishers = storage.load('PUBLISHERS');
                    if (isNull(publishers)) {
                        publishers = {};
                    } else if (!isUndefined(publishers[publisher])) {
                        console.log('publisher cache hit');
                        return !publishers[publisher];
                    }

                    const request = await get(url.ndlPublisher(publisher));
                    const hasPublisher = await parser.hasPublisher(request.responseXML);
                    publishers[publisher] = hasPublisher;
                    storage.save('PUBLISHERS', publishers);

                    return !hasPublisher;
                }
            }
            return true;
        },

        async asin(dom) {
            const element = dom.querySelector("input[name='ASIN.0']");
            if (isNull(element)) {
                return null;
            }
            return element.value;
        },

        async kindlePrice(dom) {
            const element = dom.querySelector(".kindle-price");
            if (isNull(element)) {
                return null;
            }
            return parseInt(element.innerText.match(/[0-9,]+/)[0].replace(/,/, ''));
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
                const element = dom.querySelector(".loyalty-points");
                if (isNull(element)) {
                    point = 0;
                } else {
                    point = parseInt(element.innerText.match(/[0-9,]+/)[0].replace(/,/, ''));
                }
            }

            return isNaN(point) ? 0 : point;
        },

        async price(xml) {
            const element = xml.querySelector("price");
            if (isNull(element)) {
                return null;
            }
            const price = parseInt(element.innerHTML
                .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
                .match(/[0-9]+/)[0]);

            return isNaN(price) ? null : price;
        },

        async hasPublisher(xml) {
            const element = xml.querySelector("numberOfRecords");
            if (isNull(element)) {
                return null;
            }
            return element.innerHTML !== '0';
        },

        wishlist: {
            async itemTitle(dom) {
                const element = dom.querySelector('a[id^="itemName_"]');
                if (isNull(element)) {
                    return null;
                }
                return element.innerText;
            },

            async itemAsin(dom) {
                const element = dom.querySelector('.price-section');
                if (isNull(element)) {
                    return undefined;
                }
                const attribute = element.getAttribute('data-item-prime-info');
                if (isNull(attribute)) {
                    return undefined;
                }
                return JSON.parse(attribute).asin
            },

            async isKindleItem(dom) {
                return /Kindle版/.test(dom.innerText);
            },

            async isItemProcessed(dom) {
                return dom.classList.contains('SPAW_PROCESSED');
            },

        },

        search: {
            async isKindleItem(dom) {
                const elements = dom.querySelectorAll('a.a-text-bold');
                if (elements.length !== 0) {
                    for (const element of elements) {
                        if (/^Kindle版/.test(element.innerHTML.trim())) {
                            return true;
                        }
                    }
                }
                return false;
            },

            async title(dom) {
                const title = dom.querySelector("h2 > a");
                if (isNull(title)) {
                    return null;
                }
                return title.innerText.trim();
            },

            async asin(dom) {
                return dom.getAttribute("data-asin");
            },

            async isBulkBuy(dom) {
                return /まとめ買い/.test(dom.innerText);
            }
        },


        bargain: {
            async title(dom) {
                const title = dom.querySelector("h2");
                if (isNull(title)) {
                    return null;
                }
                return title.innerText
            },

            async asin(dom) {
                const element = dom.querySelector('span.a-declarative');
                if (isNull(element)) {
                    return undefined;
                }
                const m = JSON.parse(element.getAttribute("data-a-popover")).url.match(/asin=([A-Z0-9]{10})/);
                if (isNull(m)) {
                    return undefined;
                }
                return m[1];
            },
        }
    }

    const lowPriceBook = (async (isbns) => Promise.all(isbns.map(async (isbn) => {
            let data;
            try {
                const request = await get(url.ndl(isbn));
                data = {
                    isbn: isbn,
                    price: await parser.price(request.responseXML),
                }
            } catch (e) {
                data = {
                    isbn: isbn,
                    price: null,
                }
            }

            console.log(data);
            return data;
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
                    isKdp: kindleInfo.isKdp,
                    updatedAt: Date.now(),
                };
            });
        },
        async kindleInfo(dom, data) {
            return Promise.all([
                data,
                parser.kindlePrice(dom),
                parser.pointReturn(dom),
                parser.isBought(dom),
                parser.isKdp(dom),
            ]).then(([data, kindlePrice, pointReturn, isBought, isKdp]) => {
                const info = {
                    price: isNull(kindlePrice) ? data.kindlePrice : kindlePrice,
                    point: pointReturn,
                    isBought: isBought,
                    isKdp: isKdp,
                };
                console.log('KINDLE INFO: ', info)
                return info;
            });
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
            if (isNull(paperPrice) || paperPrice === 0) {
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

            let element = dom.querySelector('#buybox tbody');
            let childNode = dom.querySelector('.print-list-price');
            if (!isNull(childNode)) {
                childNode.parentNode.removeChild(childNode);
            }
            if (isNull(element)) {
                element = dom.querySelector("#buyOneClick tbody");
            }
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

            let element = dom.querySelector('#buybox tbody');
            if (isNull(element)) {
                element = dom.querySelector("#buyOneClick tbody");
            }
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
                const title = await parser.wishlist.itemTitle(dom);
                const asin = await parser.wishlist.itemAsin(dom);
                if (!await parser.wishlist.isKindleItem(dom) || isUndefined(asin)) {
                    console.log('DROP:[' + asin + ']' + title);
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
            const title = await parser.wishlist.itemTitle(dom);
            const asin = await parser.wishlist.itemAsin(dom);

            console.log('ITEM:[' + asin + ']' + title);

            if (await parser.wishlist.isItemProcessed(dom)) {
                await this.processEnd(dom);
                return;
            }

            let data;
            if (storage.isCacheActive(asin)) {
                console.log('CACHE LOAD:[' + asin + ']' + title);
                data = storage.load(asin);
            } else {
                console.log('CACHE EXPIRE:[' + asin + ']' + title);
                const request = await get(url.amazon(asin));
                data = await itemPage.itemInfo(domParser.parseFromString(request.response, 'text/html'));

                console.log('DATA:[' + asin + ']' + title, data);
                storage.save(data.asin, data);
            }

            await this.viewPrice(dom, data);
            await this.processEnd(dom);

            console.log('END:[' + asin + ']' + title);
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

            dom.querySelector(".price-section").innerHTML = html;
        },
    }

    const searchPage = {
        discoveries: [],

        async push(nodes) {
            for (const dom of Array.from(nodes)) {
                const title = await parser.search.title(dom);
                const asin = await parser.search.asin(dom);
                if (!await parser.search.isKindleItem(dom) || isUndefined(asin) || await parser.search.isBulkBuy(dom)) {
                    console.log('DROP:[' + asin + ']' + title);
                    continue;
                }
                console.log('PUSH:[' + asin + ']' + title);
                this.processStart(dom);
                this.discoveries.push(dom);
            }
        },

        async initialize(dom) {
            await get('https://www.amazon.co.jp/gp/product/black-curtain-redirect.html');
            await this.push(dom.querySelectorAll("[data-asin]"));
            this.run();
        },

        async processStart(dom) {
            const element = dom.querySelector("h2 > a");
            if (!isNull(element)) {
                element.insertAdjacentHTML('beforebegin', '<div class="a-row SPAW_PROCESSING" style="color:#EE0077">処理中</div>');
            }
        },

        async processEnd(dom) {
            dom.querySelector('.SPAW_PROCESSING').remove();
            dom.classList.add("SPAW_PROCESSED");
        },

        async run() {
            let runCount = 0;
            while (this.discoveries.length > 0) {
                if (runCount < 5) {
                    ++runCount;
                    this.item(this.discoveries.shift()).finally(() => --runCount);
                } else {
                    await sleep(100);
                }
            }
        },

        async item(dom) {
            const title = await parser.search.title(dom);
            const asin = await parser.search.asin(dom);

            console.log('ITEM:[' + asin + ']' + title);

            let data;
            if (this.isCacheActive(asin)) {
                console.log('CACHE LOAD:[' + asin + ']' + title);
                data = storage.load(asin);
            } else {
                console.log('CACHE EXPIRE:[' + asin + ']' + title);
                const request = await get(url.amazon(asin));
                data = await itemPage.itemInfo(domParser.parseFromString(request.response, 'text/html'));
                console.log('DATA:[' + asin + ']' + title, data);
                if (!isNull(data.asin)) {
                    storage.save(data.asin, data);
                }
            }

            await this.viewPrice(dom, data);
            await this.processEnd(dom);

            console.log('END:[' + asin + ']' + title);
        },

        isCacheActive(asin) {
            if (storage.exists(asin)) {
                const data = storage.load(asin);
                if (data.isBought) {
                    return true;
                }
            }
            return storage.isCacheActive(asin);
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
            if (data.isBought) {
                html += '<div class="a-size-large" style="color:#EE0077">購入済</div>';
                html += '<div>' +
                    '<span class="a-size-base a-color-secondary">価格:￥</span>' +
                    '<span class="a-size-base a-color-secondary">' + kindlePrice + '</span>' +
                    '</div>';
                const buyButton = dom.querySelector(".a-spacing-top-mini");
                if (!isNull(buyButton)) {
                    buyButton.remove();
                }
            } else {
                if (!isNull(data.paperPrice)) {
                    html += '<div>' +
                        '<span class="a-price-symbol">紙の本:￥</span>' +
                        '<span class="a-price-whole">' + paperPrice + '</span>' +
                        '</div>';
                } else if (data.isKdp) {
                    html += '<div class="a-size-medium" style="color:#FFFFFF;background-color:#ff0000">KDP</div>';
                } else if (isNull(data.isbn)) {
                    html += '<div class="a-size-medium" style="color:#ff3c00">ISBN不明</div>';
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
            }
            html += '</div>';

            let isChanged = false;
            dom.querySelectorAll("div.a-row.a-size-base").forEach(element => {
                if (/ポイント/.test(element.innerText) || /税込/.test(element.innerText) || /購入/.test(element.innerText)) {
                    element.remove();
                } else if (/[￥\\]/.test(element.innerText)) {
                    if (!isChanged) {
                        element.innerHTML = html;
                        isChanged = true;
                    }
                }
            });
        },
    }

    const bargainPage = {
        discoveries: [],

        async push(nodes) {
            for (const dom of Array.from(nodes)) {
                const title = await parser.bargain.title(dom);
                const asin = await parser.bargain.asin(dom);
                if (isUndefined(asin)) {
                    console.log('DROP:[' + asin + ']' + title);
                    continue;
                }
                console.log('PUSH:[' + asin + ']' + title);
                this.processStart(dom);
                this.discoveries.push(dom);
            }
        },

        async initialize(dom) {
            await get('https://www.amazon.co.jp/gp/product/black-curtain-redirect.html');
            await this.push(dom.querySelectorAll(".apb-browse-searchresults-product"));
            this.run();
        },

        async processStart(dom) {
            const element = dom.querySelector("h2");
            if (!isNull(element)) {
                element.insertAdjacentHTML('beforebegin', '<div class="a-row SPAW_PROCESSING" style="color:#EE0077">処理中</div>');
            }
        },

        async processEnd(dom) {
            dom.querySelector('.SPAW_PROCESSING').remove();
            dom.classList.add("SPAW_PROCESSED");
        },

        async run() {
            let runCount = 0;
            while (this.discoveries.length > 0) {
                if (runCount < 5) {
                    ++runCount;
                    this.item(this.discoveries.shift()).finally(() => --runCount);
                } else {
                    await sleep(100);
                }
            }
        },

        async item(dom) {
            const title = await parser.bargain.title(dom);
            const asin = await parser.bargain.asin(dom);

            console.log('ITEM:[' + asin + ']' + title);

            let data;
            if (this.isCacheActive(asin)) {
                console.log('CACHE LOAD:[' + asin + ']' + title);
                data = storage.load(asin);
            } else {
                console.log('CACHE EXPIRE:[' + asin + ']' + title);
                const request = await get(url.amazon(asin));
                data = await itemPage.itemInfo(domParser.parseFromString(request.response, 'text/html'));
                console.log('DATA:[' + asin + ']' + title, data);
                if (!isNull(data.asin)) {
                    storage.save(data.asin, data);
                }
            }

            await this.viewPrice(dom, data);
            await this.processEnd(dom);

            console.log('END:[' + asin + ']' + title);
        },

        isCacheActive(asin) {
            if (storage.exists(asin)) {
                const data = storage.load(asin);
                if (data.isBought) {
                    return true;
                }
            }
            return storage.isCacheActive(asin);
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
            if (data.isBought) {
                html += '<div class="a-size-large" style="color:#EE0077">購入済</div>';
                html += '<div>' +
                    '<span class="a-size-base a-color-secondary">価格:￥</span>' +
                    '<span class="a-size-base a-color-secondary">' + kindlePrice + '</span>' +
                    '</div>';
                const buyButton = dom.querySelector(".a-spacing-top-mini");
                if (!isNull(buyButton)) {
                    buyButton.remove();
                }
            } else {
                if (!isNull(data.paperPrice)) {
                    html += '<div>' +
                        '<span class="a-price-symbol">紙の本:￥</span>' +
                        '<span class="a-price-whole">' + paperPrice + '</span>' +
                        '</div>';
                } else if (isNull(data.isbn)) {
                    html += '<div class="a-size-medium" style="color:#ff3c00">ISBN不明</div>';
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
            }
            html += '</div>';
            const parent = dom.querySelector('.a-price').parentNode;
            while (parent.lastChild) {
                parent.removeChild(parent.lastChild);
            }
            parent.insertAdjacentHTML('beforebegin', html)
        },
    }

    const main = (async () => {
        const url = location.href;
        const dom = document

        storageClean();

        if (/\/(dp|gp)\//.test(url) && await parser.isKindlePage(dom)) {
            console.log('ITEM PAGE');
            itemPage.emphasisPrice(dom);
            await itemPage.itemInfo(dom).then((data) => {
                storage.save(data.asin, data);
                itemPage.addPaperPrice(dom, data.paperPrice, data.kindlePrice);
                itemPage.addPoint(dom, data.kindlePrice, data.pointReturn);
            });

        } else if (/\/wishlist\//.test(url)) {
            console.log('WISHLIST PAGE');
            await wishlistPage.initialize(dom);
        } else if (/\/s[?\/]/.test(url)) {
            console.log('SEARCH PAGE');
            await searchPage.initialize(dom);
        } else if (/\/b[?\/]/.test(url)) {
            console.log('BARGAIN PAGE');
            await bargainPage.initialize(dom);
        }
    });

    main();
})();
