/**
 *@NApiVersion 2.x
 *@NScriptType Suitelet
 */
define(["require", "exports", "N/ui/serverWidget"], function (require, exports, ui) {
    Object.defineProperty(exports, "__esModule", { value: true });
    function onRequest(context) {
        if (context.request.method === 'GET') {
            var form = ui.createForm({
                title: 'Vault S3 Access Secret'
            });
            var secretField = form.addSecretKeyField({
                id: 'vaulted_gid',
                label: 'Token',
                restrictToScriptIds: ['customscript_kotn_s3_test', 'customscript_kotn_push_search_s3', 'customscript_kotn_s3_defer_transfer'],
                restrictToCurrentUser: false
            });
            secretField.maxLength = 64;
            var helpField = form.addField({
                label: 'Key Help',
                type: ui.FieldType.INLINEHTML,
                id: 'custpage_key_help'
            });
            helpField.defaultValue = '<span>Please prefix the secret key with AWS4 e.g. the value entered here should be like "AWS4wxzKAtPK..."</span>',
                form.addSubmitButton({
                    label: 'Store Secret'
                });
            context.response.writePage(form);
        }
        else {
            var textField = context.request.parameters.vaulted_gid;
            context.response.writeLine({
                output: 'vaulted GUID: ' + textField
            });
            context.response.writeLine({
                output: '\n  Copy the value of the vaulted GUID above and then open Setup -> Company -> General Preferences.\n' +
                    'Under \'Custom Preferences\' find the \'S3 Secret\' field. Paste the vaulted GUID there.\n\n' +
                    '  On that page you\'ll also paste the S3 Region, Bucket and Access Key.\n' +
                    'Those values are shared by all deployments of the saved search exporter scripts.'
            });
            context.response.writeLine({
                output: '\nAfter copying the GUID click your back button to return to Netsuite.'
            });
        }
    }
    exports.onRequest = onRequest;
});
