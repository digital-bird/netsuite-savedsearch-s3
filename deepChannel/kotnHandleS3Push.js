/**
 * kotnHandleS3Push.js
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NAmdConfig  ./oauthShim.json
 */
define(["require", "exports", "N/crypto", "N/encode", "N/file", "N/https", "N/log", "N/runtime", "N/util", "N/xml", "hmac", "encB"], function (require, exports, crypto, encode, file, http, log, runtime, util, xml, CryptoJS, addEnc) {
    Object.defineProperty(exports, "__esModule", { value: true });
    addEnc(CryptoJS);
    exports.MIN_S3_PART_SIZE = 5 * 1024 * 1024;
    var S3PartsPush = /** @class */ (function () {
        function S3PartsPush(filename, s3Context) {
            this.chunkCount = 0;
            this.uploadId = null;
            this.parts = [];
            this.filename = filename;
            this.s3Context = s3Context;
        }
        S3PartsPush.prototype.getUploadContext = function (localContext) {
            return util.extend(localContext, this.s3Context);
        };
        /**
         * makes a file so that any character encoding issue are handled in size calc.
         * @param {string} chunk [portion of file to send]
         */
        S3PartsPush.prototype.makeChunk = function (chunk, usePrefix) {
            if (usePrefix === void 0) { usePrefix = true; }
            var fname = (false && usePrefix) ? (this.chunkCount++ + this.filename) : this.filename;
            var f = file.create({
                name: fname,
                fileType: file.Type.CSV,
                contents: chunk,
                encoding: file.Encoding.UTF8
            });
            return f;
        };
        S3PartsPush.prototype.startParts = function () {
            var ctx = this.getUploadContext({
                filename: this.filename,
                fileType: toMime(file.Type.CSV)
            });
            this.uploadId = initPartUpload(ctx);
        };
        S3PartsPush.prototype.push = function (content) {
            if (!this.uploadId) {
                this.startParts();
            }
            var me = runtime.getCurrentScript();
            var partInfo = pushPartToS3(this.getUploadContext({
                partNumber: this.parts.length + 1,
                uploadId: this.uploadId,
                file: this.makeChunk(content)
            }));
            this.parts.push(partInfo);
        };
        S3PartsPush.prototype.finish = function (content) {
            var me = runtime.getCurrentScript();
            if (content && !this.uploadId) { // never sent just do it once
                pushToS3(this.getUploadContext({
                    file: this.makeChunk(content, false)
                }));
                return;
            }
            if (content) {
                this.push(content);
            }
            if (this.uploadId) {
                finishS3Parts(this.getUploadContext({
                    filename: this.filename,
                    uploadId: this.uploadId,
                    parts: this.parts
                }));
            }
        };
        return S3PartsPush;
    }());
    exports.S3PartsPush = S3PartsPush;
    function getHash(val) {
        var hashObj = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
        hashObj.update({
            input: val
        });
        return hashObj.digest({ outputEncoding: 'HEX' }).toLowerCase();
    }
    function getHMAC(key, base_string, toHex) {
        var hash = CryptoJS.HmacSHA256(base_string, key);
        return toHex ? hash.toString(CryptoJS.enc.Hex).toLowerCase() : hash; //.toString(CryptoJS.enc.Base64);
    }
    function toMime(nsType) {
        switch (nsType) {
            case file.Type.PLAINTEXT: return 'text/plain';
            case file.Type.CSV: return 'text/csv';
            case file.Type.HTMLDOC: return 'text/html';
            case file.Type.XMLDOC: return 'text/xml';
            default: return 'binary/octet-stream';
        }
    }
    function makeTS(d) {
        var d = d || new Date();
        return d.toISOString().replace(/.\.\d+/, '').replace(/[-:]/g, '');
    }
    function initPartUpload(context) {
        var reqDate = new Date();
        var ts = makeTS(reqDate);
        var host = context.S3Bucket + '.s3.amazonaws.com';
        var uri = context.S3Folder + '/' + context.filename;
        var payLoadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        var headers = {
            Host: host,
            'Content-Type': toMime(context.fileType),
            'x-amz-content-sha256': payLoadHash,
            'x-amz-date': ts
        };
        var headerList = [];
        for (var k in headers)
            headerList.push(k);
        headerList.sort();
        var signedHeaders = headerList.map(function (h) { return (h.toLowerCase().trim()); });
        var canonicalHeaders = headerList.map(function (h) { return (h.toLowerCase() + ':' + headers[h].trim()); });
        var canonicalRequest = [
            'POST',
            encodeURI(uri),
            'uploads=',
            canonicalHeaders.join('\n') + '\n',
            signedHeaders.join(';'),
            payLoadHash
        ].join('\n');
        var scope = ts.slice(0, 8) + '/' + context.S3Region + '/s3/aws4_request';
        var stringToSign = [
            'AWS4-HMAC-SHA256',
            ts,
            scope,
            getHash(canonicalRequest)
        ].join('\n');
        var initHMAC = crypto.createHmac({
            algorithm: crypto.HashAlg.SHA256,
            key: crypto.createSecretKey({
                guid: context.S3Secret,
                encoding: encode.Encoding.UTF_8
            })
        });
        initHMAC.update({
            input: ts.slice(0, 8),
            inputEncoding: encode.Encoding.UTF_8
        });
        var dateKey = initHMAC.digest({ outputEncoding: encode.Encoding.HEX });
        var cryptoDateKey = CryptoJS.enc.Hex.parse(dateKey);
        var dateRegionKey = getHMAC(cryptoDateKey, context.S3Region, false);
        var dateRegionServiceKey = getHMAC(dateRegionKey, "s3", false);
        var signingKey = getHMAC(dateRegionServiceKey, "aws4_request", false);
        var signature = getHMAC(signingKey, stringToSign, true);
        headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential=' + context.S3Key + '/' + scope + ',SignedHeaders=' + signedHeaders.join(';') + ',Signature=' + signature;
        log.debug({
            title: 'headerList',
            details: JSON.stringify(headerList)
        });
        log.debug({
            title: 'signedHeaders',
            details: JSON.stringify(signedHeaders)
        });
        log.debug({
            title: 'canonicalHeaders',
            details: JSON.stringify(canonicalHeaders)
        });
        log.debug({
            title: 'canonicalRequest',
            details: JSON.stringify(canonicalRequest, null, ' ')
        });
        log.debug({
            title: 'scope',
            details: JSON.stringify(scope)
        });
        log.debug({
            title: 'stringToSign',
            details: JSON.stringify(stringToSign)
        });
        // log.debug({
        // 	title:'headers',
        // 	details:JSON.stringify(headers, null, ' ')
        // });
        var resp = http.post({
            url: 'https://' + host + uri + '?uploads',
            body: null,
            headers: headers
        });
        log.audit({
            title: 'init: ' + context.filename,
            details: resp.code + ' at ' + ts
        });
        if (resp.code != 200) {
            log.error({ title: 'response code ' + ts, details: resp.code });
            log.error({ title: 'headers ' + ts, details: JSON.stringify(resp.headers, null, ' ') });
            log.error({ title: 'body ' + ts, details: resp.body || '-no body-' });
            throw new Error('Unexpected response code: ' + resp.code);
        }
        else {
            log.audit({
                title: 'started upload',
                details: resp.body
            });
        }
        var uploadPatt = /<UploadId>(.+)<\/UploadId>/;
        var uploadMatch = uploadPatt.exec(resp.body);
        return uploadMatch[1]; // throw if not found
    }
    function finishS3Parts(context) {
        log.debug({
            title: 'parts to finish:',
            details: JSON.stringify(context.parts, null, ' ')
        });
        var partContent = '<CompleteMultipartUpload>' +
            context.parts.map(function (p) { return ('<Part><PartNumber>' + p.partNumber + '</PartNumber><ETag>' + xml.escape({ xmlText: p.ETag }) + '</ETag></Part>'); }).join('\n') +
            '</CompleteMultipartUpload>';
        var transfer = file.create({
            name: 'finish_' + context.uploadId + '.xml',
            fileType: file.Type.XMLDOC,
            contents: partContent,
            encoding: file.Encoding.UTF8
        });
        var host = context.S3Bucket + '.s3.amazonaws.com';
        var uri = context.S3Folder + '/' + context.filename;
        var payLoadHash = getHash(transfer.getContents());
        var reqDate = new Date();
        var ts = makeTS(reqDate);
        var headers = {
            Host: host,
            'Content-Length': '' + transfer.size,
            // 'Content-Type' : toMime(transfer.fileType), // ; charset? 
            'x-amz-content-sha256': payLoadHash,
            'x-amz-date': ts
        };
        var headerList = [];
        for (var k in headers)
            headerList.push(k);
        headerList.sort();
        var signedHeaders = headerList.map(function (h) { return (h.toLowerCase().trim()); });
        var canonicalHeaders = headerList.map(function (h) { return (h.toLowerCase() + ':' + headers[h].trim()); });
        var canonicalRequest = [
            'POST',
            encodeURI(uri),
            'uploadId=' + encodeURIComponent(context.uploadId),
            canonicalHeaders.join('\n') + '\n',
            signedHeaders.join(';'),
            payLoadHash
        ].join('\n');
        var scope = ts.slice(0, 8) + '/' + context.S3Region + '/s3/aws4_request';
        var stringToSign = [
            'AWS4-HMAC-SHA256',
            ts,
            scope,
            getHash(canonicalRequest)
        ].join('\n');
        var initHMAC = crypto.createHmac({
            algorithm: crypto.HashAlg.SHA256,
            key: crypto.createSecretKey({
                guid: context.S3Secret,
                encoding: encode.Encoding.UTF_8
            })
        });
        initHMAC.update({
            input: ts.slice(0, 8),
            inputEncoding: encode.Encoding.UTF_8
        });
        var dateKey = initHMAC.digest({ outputEncoding: encode.Encoding.HEX });
        var cryptoDateKey = CryptoJS.enc.Hex.parse(dateKey);
        var dateRegionKey = getHMAC(cryptoDateKey, context.S3Region, false);
        var dateRegionServiceKey = getHMAC(dateRegionKey, "s3", false);
        var signingKey = getHMAC(dateRegionServiceKey, "aws4_request", false);
        var signature = getHMAC(signingKey, stringToSign, true);
        headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential=' + context.S3Key + '/' + scope + ',SignedHeaders=' + signedHeaders.join(';') + ',Signature=' + signature;
        log.debug({
            title: 'headerList',
            details: JSON.stringify(headerList)
        });
        log.debug({
            title: 'signedHeaders',
            details: JSON.stringify(signedHeaders)
        });
        log.debug({
            title: 'canonicalHeaders',
            details: JSON.stringify(canonicalHeaders)
        });
        log.debug({
            title: 'canonicalRequest',
            details: JSON.stringify(canonicalRequest, null, ' ')
        });
        log.debug({
            title: 'scope',
            details: JSON.stringify(scope)
        });
        log.debug({
            title: 'stringToSign',
            details: JSON.stringify(stringToSign)
        });
        // log.debug({
        // 	title:'headers',
        // 	details:JSON.stringify(headers, null, ' ')
        // });
        var resp = http.post({
            url: 'https://' + host + uri + '?uploadId=' + encodeURIComponent(context.uploadId),
            body: transfer.getContents(),
            headers: headers
        });
        log.audit({
            title: 'sent: ' + context.filename,
            details: resp.code + ' at ' + ts
        });
        if (resp.code != 200) {
            log.error({ title: 'response code ' + ts, details: resp.code });
            log.error({ title: 'headers ' + ts, details: JSON.stringify(resp.headers, null, ' ') });
            log.error({ title: 'body ' + ts, details: resp.body || '-no body-' });
            throw new Error('Unexpected response code: ' + resp.code);
        }
    }
    function pushPartToS3(context) {
        var transfer = context.file;
        var content = transfer.getContents();
        var host = context.S3Bucket + '.s3.amazonaws.com';
        var uri = context.S3Folder + '/' + transfer.name;
        var payLoadHash = getHash(content);
        var reqDate = new Date();
        var ts = makeTS(reqDate);
        var headers = {
            Host: host,
            'Content-Length': '' + transfer.size,
            'Content-Type': toMime(transfer.fileType),
            'x-amz-content-sha256': payLoadHash,
            'x-amz-date': ts
        };
        var headerList = [];
        for (var k in headers)
            headerList.push(k);
        headerList.sort();
        var signedHeaders = headerList.map(function (h) { return (h.toLowerCase().trim()); });
        var canonicalHeaders = headerList.map(function (h) { return (h.toLowerCase() + ':' + headers[h].trim()); });
        var canonicalRequest = [
            'PUT',
            encodeURI(uri),
            'partNumber=' + context.partNumber + '&uploadId=' + encodeURIComponent(context.uploadId),
            canonicalHeaders.join('\n') + '\n',
            signedHeaders.join(';'),
            payLoadHash
        ].join('\n');
        var scope = ts.slice(0, 8) + '/' + context.S3Region + '/s3/aws4_request';
        var stringToSign = [
            'AWS4-HMAC-SHA256',
            ts,
            scope,
            getHash(canonicalRequest)
        ].join('\n');
        var initHMAC = crypto.createHmac({
            algorithm: crypto.HashAlg.SHA256,
            key: crypto.createSecretKey({
                guid: context.S3Secret,
                encoding: encode.Encoding.UTF_8
            })
        });
        initHMAC.update({
            input: ts.slice(0, 8),
            inputEncoding: encode.Encoding.UTF_8
        });
        var dateKey = initHMAC.digest({ outputEncoding: encode.Encoding.HEX });
        var cryptoDateKey = CryptoJS.enc.Hex.parse(dateKey);
        var dateRegionKey = getHMAC(cryptoDateKey, context.S3Region, false);
        var dateRegionServiceKey = getHMAC(dateRegionKey, "s3", false);
        var signingKey = getHMAC(dateRegionServiceKey, "aws4_request", false);
        var signature = getHMAC(signingKey, stringToSign, true);
        headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential=' + context.S3Key + '/' + scope + ',SignedHeaders=' + signedHeaders.join(';') + ',Signature=' + signature;
        log.debug({
            title: 'headerList',
            details: JSON.stringify(headerList)
        });
        log.debug({
            title: 'signedHeaders',
            details: JSON.stringify(signedHeaders)
        });
        log.debug({
            title: 'canonicalHeaders',
            details: JSON.stringify(canonicalHeaders)
        });
        log.debug({
            title: 'canonicalRequest',
            details: JSON.stringify(canonicalRequest, null, ' ')
        });
        log.debug({
            title: 'scope',
            details: JSON.stringify(scope)
        });
        log.debug({
            title: 'stringToSign',
            details: JSON.stringify(stringToSign)
        });
        // log.debug({
        // 	title:'headers',
        // 	details:JSON.stringify(headers, null, ' ')
        // });
        var resp = http.put({
            url: 'https://' + host + uri + '?partNumber=' + context.partNumber + '&uploadId=' + encodeURIComponent(context.uploadId),
            body: content,
            headers: headers
        });
        log.audit({
            title: 'sent: ' + context.file.name,
            details: resp.code + ' at ' + ts
        });
        if (resp.code != 200) {
            log.error({ title: 'response code ' + ts, details: resp.code });
            log.error({ title: 'headers ' + ts, details: JSON.stringify(resp.headers, null, ' ') });
            log.error({ title: 'body ' + ts, details: resp.body || '-no body-' });
        }
        return {
            partNumber: context.partNumber,
            ETag: resp.headers['ETag']
        };
    }
    function syncDelay(delayTime, context) {
        var tsEnd = Date.now() + delayTime;
        while (Date.now() < tsEnd) {
            //Use hmac since it has some computational expense but costs no governance
            var delayHMAC = crypto.createHmac({
                algorithm: crypto.HashAlg.SHA256,
                key: crypto.createSecretKey({
                    guid: context.S3Secret,
                    encoding: encode.Encoding.UTF_8
                })
            });
            var ts = Date.now();
            delayHMAC.update({
                input: (Math.atan(ts) * Math.tan(ts)).toFixed(8),
                inputEncoding: encode.Encoding.UTF_8
            });
            delayHMAC.digest({ outputEncoding: encode.Encoding.BASE_64_URL_SAFE });
        }
    }
    function pushToS3(context) {
        var transfer = context.file;
        var content = transfer.getContents();
        var host = context.S3Bucket + '.s3.amazonaws.com';
        var uri = context.S3Folder + '/' + transfer.name;
        var payLoadHash = getHash(content);
        var reqDate = new Date();
        var ts = makeTS(reqDate);
        var headers = {
            Host: host,
            'Content-Length': '' + transfer.size,
            'Content-Type': toMime(transfer.fileType),
            'x-amz-content-sha256': payLoadHash,
            'x-amz-date': ts
        };
        var headerList = [];
        for (var k in headers)
            headerList.push(k);
        headerList.sort();
        var signedHeaders = headerList.map(function (h) { return (h.toLowerCase().trim()); });
        var canonicalHeaders = headerList.map(function (h) { return (h.toLowerCase() + ':' + headers[h].trim()); });
        var canonicalRequest = [
            'PUT',
            encodeURI(uri),
            '',
            canonicalHeaders.join('\n') + '\n',
            signedHeaders.join(';'),
            payLoadHash
        ].join('\n');
        var scope = ts.slice(0, 8) + '/' + context.S3Region + '/s3/aws4_request';
        var stringToSign = [
            'AWS4-HMAC-SHA256',
            ts,
            scope,
            getHash(canonicalRequest)
        ].join('\n');
        var initHMAC = crypto.createHmac({
            algorithm: crypto.HashAlg.SHA256,
            key: crypto.createSecretKey({
                guid: context.S3Secret,
                encoding: encode.Encoding.UTF_8
            })
        });
        initHMAC.update({
            input: ts.slice(0, 8),
            inputEncoding: encode.Encoding.UTF_8
        });
        var dateKey = initHMAC.digest({ outputEncoding: encode.Encoding.HEX });
        var cryptoDateKey = CryptoJS.enc.Hex.parse(dateKey);
        var dateRegionKey = getHMAC(cryptoDateKey, context.S3Region, false);
        var dateRegionServiceKey = getHMAC(dateRegionKey, "s3", false);
        var signingKey = getHMAC(dateRegionServiceKey, "aws4_request", false);
        var signature = getHMAC(signingKey, stringToSign, true);
        headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential=' + context.S3Key + '/' + scope + ',SignedHeaders=' + signedHeaders.join(';') + ',Signature=' + signature;
        log.debug({
            title: 'headerList',
            details: JSON.stringify(headerList)
        });
        log.debug({
            title: 'signedHeaders',
            details: JSON.stringify(signedHeaders)
        });
        log.debug({
            title: 'canonicalHeaders',
            details: JSON.stringify(canonicalHeaders)
        });
        log.debug({
            title: 'canonicalRequest',
            details: JSON.stringify(canonicalRequest, null, ' ')
        });
        log.debug({
            title: 'scope',
            details: JSON.stringify(scope)
        });
        log.debug({
            title: 'stringToSign',
            details: JSON.stringify(stringToSign)
        });
        // log.debug({
        // 	title:'headers',
        // 	details:JSON.stringify(headers, null, ' ')
        // });
        var origErr = null;
        var tries = 3;
        var resp = null;
        while (tries) {
            tries--;
            try {
                resp = http.put({
                    url: 'https://' + host + uri,
                    body: content,
                    headers: headers
                });
                break; //no error end the loop
            }
            catch (e) {
                if (!origErr)
                    origErr = e;
                if (!tries)
                    throw origErr || e;
                log.error({
                    title: 'sending part to S3',
                    details: (e.message || e.toString()) + (e.getStackTrace ? (' \n \n' + e.getStackTrace().join(' \n')) : '')
                });
                syncDelay(5000, context);
            }
        }
        log.audit({
            title: 'sent: ' + context.file.name,
            details: resp.code + ' at ' + ts
        });
        if (resp.code != 200) {
            log.error({ title: 'response code ' + ts, details: resp.code });
            log.error({ title: 'headers ' + ts, details: JSON.stringify(resp.headers, null, ' ') });
            log.error({ title: 'body ' + ts, details: resp.body || '-no body-' });
        }
    }
    function escapeCSV(val) {
        if (!val)
            return '';
        return !(/[",\s]/).test(val) ? val : ('"' + val.replace(/"/g, '""') + '"');
    }
});
