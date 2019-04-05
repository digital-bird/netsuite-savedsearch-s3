/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NAmdConfig  ./oauthShim.json
 */

import {EntryPoints} from 'N/types';

import * as crypto from 'N/crypto';
import * as encode from 'N/encode';
import * as file from 'N/file';
import * as http from 'N/https';
import * as log from 'N/log';
import * as runtime from 'N/runtime';
import * as search from 'N/search';
import * as util from 'N/util';
import * as xml from 'N/xml';

import * as CryptoJS  from 'hmac';
import * as addEnc  from 'encB';
addEnc(CryptoJS);

class S3PartsPush{
	filename:string;
	chunkCount:number = 0;
	uploadId:string = null;
	parts = [];

	constructor(filename : string){
		this.filename = filename;
	}

	getUploadContext(){
		var me = runtime.getCurrentScript();
		return {
			S3Region: me.getParameter({name:'custscript_kotn_s3_region'}),
			S3Key : me.getParameter({name:'custscript_kotn_s3_key'}),
			S3Secret : me.getParameter({name:'custscript_kotn_s3_secret'}),
			S3Bucket : me.getParameter({name:'custscript_kotn_s3_bucket'}),
			S3Folder : me.getParameter({name:'custscript_kotn_s3_folder'}) || ''
		}
	}

	/**
	 * makes a file so that any character encoding issue are handled in size calc.
	 * @param {string} chunk [portion of file to send]
	 */
	private makeChunk(chunk, usePrefix = true){
		var fname = (false && usePrefix) ? (this.chunkCount++ + this.filename) : this.filename;
		var f = file.create({
			name: fname,
			fileType: file.Type.CSV,
			contents: chunk,
			encoding:file.Encoding.UTF8
		});
		return f;
	}

	startParts(){

		var ctx = util.extend({
			filename: this.filename,
			fileType:toMime(file.Type.CSV)
		}, this.getUploadContext());

		this.uploadId = initPartUpload(ctx);
	}

	push(content){
		if(!this.uploadId){
			this.startParts();
		}
		var me = runtime.getCurrentScript();
		var partInfo = pushPartToS3(util.extend({
				partNumber: this.parts.length + 1,
				uploadId: this.uploadId,
				file:this.makeChunk(content)
			}, this.getUploadContext())
		);
		this.parts.push(partInfo);

	}

	finish(content){
		var me = runtime.getCurrentScript();
		if(content && !this.uploadId){ // never sent just do it once
			pushToS3(util.extend({
				file:this.makeChunk(content, false)
			}, this.getUploadContext()));
			return;
		}
		if(content){
			this.push(content);
		}
		if(this.uploadId) { 
			finishS3Parts(util.extend({
				filename:this.filename,
				uploadId: this.uploadId,
				parts:this.parts
			}, this.getUploadContext())
		);

		}
		
	}

}

function getHash(val){
	var hashObj = crypto.createHash({algorithm:crypto.HashAlg.SHA256});
	hashObj.update({
		input:val
	});
	return hashObj.digest({outputEncoding:'HEX'}).toLowerCase();
}

function getHMAC(key, base_string, toHex) {
	var hash = CryptoJS.HmacSHA256(base_string, key);
	return toHex ? hash.toString(CryptoJS.enc.Hex).toLowerCase() : hash; //.toString(CryptoJS.enc.Base64);
}

function toMime(nsType){
	switch(nsType){
		case file.Type.PLAINTEXT : return 'text/plain';
		case file.Type.CSV : return 'text/csv';
		case file.Type.HTMLDOC : return 'text/html';
		case file.Type.XMLDOC : return 'text/xml';
		default: return 'binary/octet-stream';
	}
}

const MIN_S3_PART_SIZE = 5 * 1024 * 1024;



function makeTS(d){
	var d = d || new Date();
	return d.toISOString().replace(/.\.\d+/, '').replace(/[-:]/g, '');
}




function initPartUpload(context) {

	var reqDate = new Date();
	var ts = makeTS(reqDate);

	var host = context.S3Bucket+'.s3.amazonaws.com';

	var uri = context.S3Folder +'/'+ context.filename;

	var payLoadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';


	var headers = {
		Host: host,
		'Content-Type' : toMime(context.fileType), // ; charset? 
		'x-amz-content-sha256' : payLoadHash,
		'x-amz-date' : ts
	};

	var headerList = [];
	for(var k in headers) headerList.push(k);
	headerList.sort();

	var signedHeaders = headerList.map(h=>(h.toLowerCase().trim()));

	var canonicalHeaders = headerList.map(h=>(h.toLowerCase() +':'+headers[h].trim()));

	var canonicalRequest = [
		'POST',
		encodeURI(uri),
		'uploads=',
		canonicalHeaders.join('\n')+'\n',
		signedHeaders.join(';'),
		payLoadHash
	].join('\n');


	var scope = ts.slice(0,8) +'/' + context.S3Region +'/s3/aws4_request';

	var stringToSign =[
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
    	input:ts.slice(0,8),
    	inputEncoding:encode.Encoding.UTF_8
    });

	var dateKey              = initHMAC.digest({ outputEncoding: encode.Encoding.HEX});
	var cryptoDateKey = CryptoJS.enc.Hex.parse(dateKey);
	var dateRegionKey        = getHMAC(cryptoDateKey, context.S3Region, false);
	var dateRegionServiceKey = getHMAC(dateRegionKey, "s3", false);
	var signingKey           = getHMAC(dateRegionServiceKey, "aws4_request", false);


	var signature = getHMAC(signingKey, stringToSign, true);

	headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential='+ context.S3Key +'/'+ scope +',SignedHeaders='+ signedHeaders.join(';') +',Signature=' + signature;


	log.debug({
		title: 'headerList',
		details:JSON.stringify(headerList)
	});
	log.debug({
		title:'signedHeaders',
		details:JSON.stringify(signedHeaders)
	});

	log.debug({
		title:'canonicalHeaders',
		details:JSON.stringify(canonicalHeaders)
	});

	log.debug({
		title:'canonicalRequest',
		details:JSON.stringify(canonicalRequest,null, ' ')
	});

	log.debug({
		title:'scope',
		details:JSON.stringify(scope)
	});

	log.debug({
		title:'stringToSign',
		details:JSON.stringify(stringToSign)
	});

	// log.debug({
	// 	title:'headers',
	// 	details:JSON.stringify(headers, null, ' ')
	// });

	var resp = http.post({
		url: 'https://'+host + uri  +'?uploads',
		body: null,
		headers:headers
	});

	log.audit({
		title: 'init: '+ context.filename,
		details: resp.code +' at '+ ts
	});

	if(resp.code != 200){
		log.error({ title: 'response code '+ts, details: resp.code });
		log.error({ title: 'headers '+ts, details:JSON.stringify(resp.headers, null, ' ') });
		log.error({ title: 'body '+ts, details: resp.body || '-no body-' });
		throw new Error('Unexpected response code: '+ resp.code);
	}else{
		log.audit({
            title:'started upload',
            details: resp.body
        });
	}

	var uploadPatt = /<UploadId>(.+)<\/UploadId>/;
	var uploadMatch = uploadPatt.exec(resp.body);
	return uploadMatch[1]; // throw if not found
}

function finishS3Parts(context){
	log.debug({
		title:'parts to finish:',
		details:JSON.stringify(context.parts, null, ' ')
	});

	var partContent = '<CompleteMultipartUpload>'+ 
		context.parts.map(p=>('<Part><PartNumber>'+ p.partNumber +'</PartNumber><ETag>'+ xml.escape({xmlText:p.ETag}) +'</ETag></Part>')).join('\n') +
		'</CompleteMultipartUpload>';

	var transfer = file.create({
		name: 'finish_'+ context.uploadId +'.xml',
		fileType: file.Type.XMLDOC,
		contents: partContent,
		encoding:file.Encoding.UTF8
	});
	var host = context.S3Bucket+'.s3.amazonaws.com';

	var uri = context.S3Folder +'/'+ context.filename;


	var payLoadHash = getHash(transfer.getContents());

	var reqDate = new Date();
	var ts = makeTS(reqDate);

	var headers = {
		Host: host,
		'Content-Length': ''+transfer.size, // use file.size for bytes
		// 'Content-Type' : toMime(transfer.fileType), // ; charset? 
		'x-amz-content-sha256' : payLoadHash,
		'x-amz-date' : ts
	};

	var headerList = [];
	for(var k in headers) headerList.push(k);
	headerList.sort();

	var signedHeaders = headerList.map(h=>(h.toLowerCase().trim()));

	var canonicalHeaders = headerList.map(h=>(h.toLowerCase() +':'+headers[h].trim()));

	var canonicalRequest = [
		'POST',
		encodeURI(uri),
		'uploadId='+ encodeURIComponent(context.uploadId),
		canonicalHeaders.join('\n')+'\n',
		signedHeaders.join(';'),
		payLoadHash
	].join('\n');


	var scope = ts.slice(0,8) +'/' + context.S3Region +'/s3/aws4_request';

	var stringToSign =[
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
    	input:ts.slice(0,8),
    	inputEncoding:encode.Encoding.UTF_8
    });

	var dateKey              = initHMAC.digest({ outputEncoding: encode.Encoding.HEX});
	var cryptoDateKey = CryptoJS.enc.Hex.parse(dateKey);
	var dateRegionKey        = getHMAC(cryptoDateKey, context.S3Region, false);
	var dateRegionServiceKey = getHMAC(dateRegionKey, "s3", false);
	var signingKey           = getHMAC(dateRegionServiceKey, "aws4_request", false);


	var signature = getHMAC(signingKey, stringToSign, true);

	headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential='+ context.S3Key +'/'+ scope +',SignedHeaders='+ signedHeaders.join(';') +',Signature=' + signature;


	log.debug({
		title: 'headerList',
		details:JSON.stringify(headerList)
	});
	log.debug({
		title:'signedHeaders',
		details:JSON.stringify(signedHeaders)
	});

	log.debug({
		title:'canonicalHeaders',
		details:JSON.stringify(canonicalHeaders)
	});

	log.debug({
		title:'canonicalRequest',
		details:JSON.stringify(canonicalRequest,null, ' ')
	});

	log.debug({
		title:'scope',
		details:JSON.stringify(scope)
	});

	log.debug({
		title:'stringToSign',
		details:JSON.stringify(stringToSign)
	});

	// log.debug({
	// 	title:'headers',
	// 	details:JSON.stringify(headers, null, ' ')
	// });

	var resp = http.post({
		url: 'https://'+host + uri  +'?uploadId='+ encodeURIComponent(context.uploadId),
		body: transfer.getContents(),
		headers:headers
	});

	log.audit({
		title: 'sent: '+ context.filename,
		details: resp.code +' at '+ ts
	});

	if(resp.code != 200){
		log.error({ title: 'response code '+ts, details: resp.code });
		log.error({ title: 'headers '+ts, details:JSON.stringify(resp.headers, null, ' ') });
		log.error({ title: 'body '+ts, details: resp.body || '-no body-' });
		throw new Error('Unexpected response code: '+ resp.code);
	}
}

function pushPartToS3(context) {

	var transfer = context.file;

	var content = transfer.getContents();
	var host = context.S3Bucket+'.s3.amazonaws.com';

	var uri = context.S3Folder +'/'+ transfer.name;


	var payLoadHash = getHash(content);


	var reqDate = new Date();
	var ts = makeTS(reqDate);


	var headers = {
		Host: host,
		'Content-Length': ''+transfer.size, // use file.size for bytes
		'Content-Type' : toMime(transfer.fileType), // ; charset? 
		'x-amz-content-sha256' : payLoadHash,
		'x-amz-date' : ts
	};

	var headerList = [];
	for(var k in headers) headerList.push(k);
	headerList.sort();

	var signedHeaders = headerList.map(h=>(h.toLowerCase().trim()));

	var canonicalHeaders = headerList.map(h=>(h.toLowerCase() +':'+headers[h].trim()));

	var canonicalRequest = [
		'PUT',
		encodeURI(uri),
		'partNumber='+ context.partNumber +'&uploadId='+encodeURIComponent(context.uploadId),
		canonicalHeaders.join('\n')+'\n',
		signedHeaders.join(';'),
		payLoadHash
	].join('\n');


	var scope = ts.slice(0,8) +'/' + context.S3Region +'/s3/aws4_request';

	var stringToSign =[
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
    	input:ts.slice(0,8),
    	inputEncoding:encode.Encoding.UTF_8
    });

	var dateKey              = initHMAC.digest({ outputEncoding: encode.Encoding.HEX});
	var cryptoDateKey = CryptoJS.enc.Hex.parse(dateKey);
	var dateRegionKey        = getHMAC(cryptoDateKey, context.S3Region, false);
	var dateRegionServiceKey = getHMAC(dateRegionKey, "s3", false);
	var signingKey           = getHMAC(dateRegionServiceKey, "aws4_request", false);


	var signature = getHMAC(signingKey, stringToSign, true);

	headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential='+ context.S3Key +'/'+ scope +',SignedHeaders='+ signedHeaders.join(';') +',Signature=' + signature;


	log.debug({
		title: 'headerList',
		details:JSON.stringify(headerList)
	});
	log.debug({
		title:'signedHeaders',
		details:JSON.stringify(signedHeaders)
	});

	log.debug({
		title:'canonicalHeaders',
		details:JSON.stringify(canonicalHeaders)
	});

	log.debug({
		title:'canonicalRequest',
		details:JSON.stringify(canonicalRequest,null, ' ')
	});

	log.debug({
		title:'scope',
		details:JSON.stringify(scope)
	});

	log.debug({
		title:'stringToSign',
		details:JSON.stringify(stringToSign)
	});

	// log.debug({
	// 	title:'headers',
	// 	details:JSON.stringify(headers, null, ' ')
	// });

	var resp = http.put({
		url: 'https://'+host + uri +'?partNumber='+ context.partNumber +'&uploadId='+encodeURIComponent(context.uploadId),
		body: content,
		headers:headers
	});

	log.audit({
		title: 'sent: '+ context.file.name,
		details: resp.code +' at '+ ts
	});

	if(resp.code != 200){
		log.error({ title: 'response code '+ts, details: resp.code });
		log.error({ title: 'headers '+ts, details:JSON.stringify(resp.headers, null, ' ') });
		log.error({ title: 'body '+ts, details: resp.body || '-no body-' });
	}

	return {
		partNumber: context.partNumber,
		ETag: resp.headers['ETag']
	};
}

function pushToS3(context) {

	var transfer = context.file;

	var content = transfer.getContents();
	var host = context.S3Bucket+'.s3.amazonaws.com';

	var uri = context.S3Folder +'/'+ transfer.name;


	var payLoadHash = getHash(content);


	var reqDate = new Date();
	var ts = makeTS(reqDate);


	var headers = {
		Host: host,
		'Content-Length': ''+transfer.size, // use file.size for bytes
		'Content-Type' : toMime(transfer.fileType), // ; charset? 
		'x-amz-content-sha256' : payLoadHash,
		'x-amz-date' : ts
	};

	var headerList = [];
	for(var k in headers) headerList.push(k);
	headerList.sort();

	var signedHeaders = headerList.map(h=>(h.toLowerCase().trim()));

	var canonicalHeaders = headerList.map(h=>(h.toLowerCase() +':'+headers[h].trim()));

	var canonicalRequest = [
		'PUT',
		encodeURI(uri),
		'',
		canonicalHeaders.join('\n')+'\n',
		signedHeaders.join(';'),
		payLoadHash
	].join('\n');


	var scope = ts.slice(0,8) +'/' + context.S3Region +'/s3/aws4_request';

	var stringToSign =[
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
    	input:ts.slice(0,8),
    	inputEncoding:encode.Encoding.UTF_8
    });

	var dateKey              = initHMAC.digest({ outputEncoding: encode.Encoding.HEX});
	var cryptoDateKey = CryptoJS.enc.Hex.parse(dateKey);
	var dateRegionKey        = getHMAC(cryptoDateKey, context.S3Region, false);
	var dateRegionServiceKey = getHMAC(dateRegionKey, "s3", false);
	var signingKey           = getHMAC(dateRegionServiceKey, "aws4_request", false);


	var signature = getHMAC(signingKey, stringToSign, true);

	headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential='+ context.S3Key +'/'+ scope +',SignedHeaders='+ signedHeaders.join(';') +',Signature=' + signature;


	log.debug({
		title: 'headerList',
		details:JSON.stringify(headerList)
	});
	log.debug({
		title:'signedHeaders',
		details:JSON.stringify(signedHeaders)
	});

	log.debug({
		title:'canonicalHeaders',
		details:JSON.stringify(canonicalHeaders)
	});

	log.debug({
		title:'canonicalRequest',
		details:JSON.stringify(canonicalRequest,null, ' ')
	});

	log.debug({
		title:'scope',
		details:JSON.stringify(scope)
	});

	log.debug({
		title:'stringToSign',
		details:JSON.stringify(stringToSign)
	});

	// log.debug({
	// 	title:'headers',
	// 	details:JSON.stringify(headers, null, ' ')
	// });

	var resp = http.put({
		url: 'https://'+host + uri,
		body: content,
		headers:headers
	});

	log.audit({
		title: 'sent: '+ context.file.name,
		details: resp.code +' at '+ ts
	});

	if(resp.code != 200){
		log.error({ title: 'response code '+ts, details: resp.code });
		log.error({ title: 'headers '+ts, details:JSON.stringify(resp.headers, null, ' ') });
		log.error({ title: 'body '+ts, details: resp.body || '-no body-' });
	}
}

function escapeCSV(val){
	if (!val) return '';
	return !(/[",\s]/).test(val) ? val : ('"' + val.replace(/"/g, '""') + '"');
}

export function execute(ctx){
	var me = runtime.getCurrentScript();
	var searchId = me.getParameter({name:'custscript_kotn_s3_search'});
	var includeTS = me.getParameter({name:'custscript_kotn_s3_use_ts'});
	var lineLimit = parseInt(me.getParameter({name:'custscript_kotn_s3_lines'}),10) || 0;

	var srch :search.Search = search.load({id: searchId});

	var title = srch.title;
	if(!title){
		var srchInfo = search.lookupFields({
			type:search.Type.SAVED_SEARCH,
			id:searchId,
			columns:[
				'title'
			]
		});

		log.debug({
			title:'looked up title for '+ searchId,
			details:JSON.stringify(srchInfo)
		});

		title = srchInfo.title;
	}
	var name = title.replace(/\W/g, ' ').replace(/ +/g, ' ').replace(/ /g, '_');

	if(includeTS){
		name += '_'+ makeTS(new Date());
	}

	name += '.csv';

	var S3Parts = new S3PartsPush(name);

	var accum = "";
	var sentHeader = false;
	const pagedResults = srch.runPaged({pageSize:1000}); //5 units

	var linesReported = 0;

	pagedResults.pageRanges.forEach(function(pageRange){
		log.debug({
			title:name,
			details:'collecting page '+ pageRange.index
		});
		if(lineLimit && linesReported >= lineLimit) return;
		var myPage = pagedResults.fetch({index: pageRange.index}); //5 Units
		myPage.data.forEach(function(result){
			if(lineLimit && linesReported >= lineLimit) return;
			var cols = result.columns;
			if(!sentHeader){
				// add header
				var headerLine = cols.map(c=>{
					return escapeCSV(c.label || c.name);
				}).join(',');
				sentHeader = true;
				accum += headerLine;
			}
			linesReported++;
			var lineData = (cols.map(c=>{
				return escapeCSV(result.getText(c) || result.getValue(c));
			}).join(','));

			accum += '\n'+ lineData;
			//TEST to push sample file page over 5MB
			// for(var i = 0;i< 200; i++){
			// 	accum += '\n'+ lineData;
			// }

		});
		if(accum.length > MIN_S3_PART_SIZE){
			S3Parts.push(accum);
			accum = "";
		}
	});

	S3Parts.finish(accum);

	if(!linesReported){
		log.audit({
			title:'no contents for '+name,
			details:null
		});
		return;
	}

	log.audit({
		title:'sending '+name,
		details:linesReported +' lines'
	});

};