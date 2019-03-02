/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NAmdConfig  ./oauthShim.json
 */
define(["require", "exports", "N/crypto", "N/encode", "N/file", "N/https", "N/log", "N/runtime", "N/search", "hmac", "encB"], function (require, exports, crypto, encode, file, http, log, runtime, search, CryptoJS, addEnc) {
    Object.defineProperty(exports, "__esModule", { value: true });
    addEnc(CryptoJS);
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
            default: return 'binary/octet-stream';
        }
    }
    var reqDate = new Date();
    function makeTS(d) {
        var d = d || new Date();
        return d.toISOString().replace(/.\.\d+/, '').replace(/[-:]/g, '');
    }
    function pushToS3(context) {
        // var accessSecret = 'wxzKAtPKzEgOSEb6A42juHtWfRy7KtFnYkSl18/p';
        var transfer = context.file;
        var content = transfer.getContents();
        var host = context.S3Bucket + '.s3.amazonaws.com';
        var uri = context.S3Folder + '/' + transfer.name;
        var payLoadHash = getHash(content);
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
        var resp = http.put({
            url: 'https://' + host + uri,
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
    }
    function escapeCSV(val) {
        if (!val)
            return '';
        if (!(/[",\s]/).test(val))
            return val;
        val = val.replace(/"/g, '""');
        return '"' + val + '"';
    }
    ;
    function execute(ctx) {
        var me = runtime.getCurrentScript();
        var searchId = me.getParameter({ name: 'custscript_kotn_s3_search' });
        var includeTS = me.getParameter({ name: 'custscript_kotn_s3_use_ts' });
        var lineLimit = parseInt(me.getParameter({ name: 'custscript_kotn_s3_lines' }), 10) || 0;
        var srch = search.load({ id: searchId });
        var title = srch.title;
        if (!title) {
            var srchInfo = search.lookupFields({
                type: search.Type.SAVED_SEARCH,
                id: searchId,
                columns: [
                    'title'
                ]
            });
            log.debug({
                title: 'looked up title for ' + searchId,
                details: JSON.stringify(srchInfo)
            });
            title = srchInfo.title;
        }
        var name = title.replace(/\W/g, ' ').replace(/ +/g, ' ').replace(/ /g, '_');
        if (includeTS) {
            name += '_' + makeTS(new Date());
        }
        name += '.csv';
        var accum = [];
        var pagedResults = srch.runPaged({ pageSize: 1000 }); //5 units
        if (lineLimit)
            lineLimit++; // include header
        pagedResults.pageRanges.forEach(function (pageRange) {
            if (lineLimit && accum.length >= lineLimit)
                return;
            var myPage = pagedResults.fetch({ index: pageRange.index }); //5 Units
            myPage.data.forEach(function (result) {
                var cols = result.columns;
                if (!accum.length) {
                    // add header
                    var headerLine = cols.map(function (c) {
                        return escapeCSV(c.label || c.name);
                    }).join(',');
                    accum = accum.concat(headerLine);
                }
                accum.push(cols.map(function (c) {
                    return result.getText(c) || result.getValue(c);
                }).join(','));
            });
        });
        if (lineLimit)
            accum = accum.slice(0, lineLimit);
        var f = file.create({
            name: name,
            fileType: file.Type.CSV,
            contents: accum.join('\n'),
            encoding: file.Encoding.UTF8
        });
        pushToS3({
            S3Region: me.getParameter({ name: 'custscript_kotn_s3_region' }),
            S3Key: me.getParameter({ name: 'custscript_kotn_s3_key' }),
            S3Secret: me.getParameter({ name: 'custscript_kotn_s3_secret' }),
            S3Bucket: me.getParameter({ name: 'custscript_kotn_s3_bucket' }),
            S3Folder: me.getParameter({ name: 'custscript_kotn_s3_folder' }),
            file: f
        });
    }
    exports.execute = execute;
    ;
});
