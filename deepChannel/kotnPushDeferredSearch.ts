/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NAmdConfig  ./oauthShim.json
 */

import {EntryPoints} from 'N/types';

import * as file from 'N/file';
import * as log from 'N/log';
import * as runtime from 'N/runtime';
import * as search from 'N/search';
import * as task from 'N/task';

import * as s3Push from './kotnHandleS3Push';


function escapeCSV(val){
	if (!val) return '';
	return !(/[",\s]/).test(val) ? val : ('"' + val.replace(/"/g, '""') + '"');
}

export function execute(ctx){
	var me : runtime.Script = runtime.getCurrentScript();
	if(runtime.envType == runtime.EnvType.SANDBOX){
		var sbEnabled = me.getParameter({name:'custscript_kotn_s3d_enable_in_sandbox'});
		if(!sbEnabled){
			log.audit({
				title:me.id,
				details:'skipping sandbox run'
			});
			return;
		}
	}
	var s3Folder = me.getParameter({name:'custscript_kotn_deferred_s3_folder'});
	var nsFilePath = me.getParameter({name:'custscript_kotn_deferred_s3_file'});

	var parts = nsFilePath.split('/');
	var name = parts.pop().toString();

	log.audit({
		title:"sending deferred file "+ name,
		details: "from "+ nsFilePath +' to '+ s3Folder
	});

	var resultsFile = file.load({id:nsFilePath});

	var s3Ctx = {
		S3Region: me.getParameter({name:'custscript_kotn_s3_region'}),
		S3Key : me.getParameter({name:'custscript_kotn_s3_key'}),
		S3Secret : me.getParameter({name:'custscript_kotn_s3_secret'}),
		S3Bucket : me.getParameter({name:'custscript_kotn_s3_bucket'}),
		S3Folder : s3Folder || ''
	}

	log.debug({
		title:'deferred S3 Context',
		details: JSON.stringify(s3Ctx, null, ' ')
	});

	var S3Parts = new s3Push.S3PartsPush(name, s3Ctx);

	var accum = "";

	var linesReported = -1; // expect a header.

	resultsFile.lines.iterator().each((line)=>{
		linesReported++;
		accum += line.value +'\n';
		if(accum.length > s3Push.MIN_S3_PART_SIZE){
			S3Parts.push(accum);
			accum = "";
		}
		return true;
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