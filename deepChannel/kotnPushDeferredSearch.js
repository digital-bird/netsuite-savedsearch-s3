/**
 * @NApiVersion 2.x
 * @NScriptType ScheduledScript
 * @NAmdConfig  ./oauthShim.json
 */
define(["require", "exports", "N/file", "N/log", "N/runtime", "./kotnHandleS3Push"], function (require, exports, file, log, runtime, s3Push) {
    Object.defineProperty(exports, "__esModule", { value: true });
    function escapeCSV(val) {
        if (!val)
            return '';
        return !(/[",\s]/).test(val) ? val : ('"' + val.replace(/"/g, '""') + '"');
    }
    function execute(ctx) {
        var me = runtime.getCurrentScript();
        var s3Folder = me.getParameter({ name: 'custscript_kotn_deferred_s3_folder' });
        var nsFilePath = me.getParameter({ name: 'custscript_kotn_deferred_s3_file' });
        var parts = nsFilePath.split('/');
        var name = parts.pop().toString();
        log.audit({
            title: "sending deferred file " + name,
            details: "from " + nsFilePath + ' to ' + s3Folder
        });
        var resultsFile = file.load({ id: nsFilePath });
        var s3Ctx = {
            S3Region: me.getParameter({ name: 'custscript_kotn_s3_region' }),
            S3Key: me.getParameter({ name: 'custscript_kotn_s3_key' }),
            S3Secret: me.getParameter({ name: 'custscript_kotn_s3_secret' }),
            S3Bucket: me.getParameter({ name: 'custscript_kotn_s3_bucket' }),
            S3Folder: s3Folder || ''
        };
        log.debug({
            title: 'deferred S3 Context',
            details: JSON.stringify(s3Ctx, null, ' ')
        });
        var S3Parts = new s3Push.S3PartsPush(name, s3Ctx);
        var accum = "";
        var linesReported = -1; // expect a header.
        resultsFile.lines.iterator().each(function (line) {
            linesReported++;
            accum += line.value + '\n';
            if (accum.length > s3Push.MIN_S3_PART_SIZE) {
                S3Parts.push(accum);
                accum = "";
            }
            return true;
        });
        S3Parts.finish(accum);
        if (!linesReported) {
            log.audit({
                title: 'no contents for ' + name,
                details: null
            });
            return;
        }
        log.audit({
            title: 'sending ' + name,
            details: linesReported + ' lines'
        });
    }
    exports.execute = execute;
    ;
});
