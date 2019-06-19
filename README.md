# Deep Channel for Netsuite Saved Search Export

These scripts set up periodic exports of Netsuite saved searches to an S3 Bucket.

For ease of installation the scripts here may also be installed via the SuiteBundle 271853 -- "Deep Channel to S3"

The original code was written in Typescript and transpiled to Javascript. The package.json and tsconfig.json files are used to set up the TS compiliation environment.

## Operation

The code is used to create a scheduled script. Each deployment is configured with a saved search as a parameter and may be set up to convert that search to a CSV and export the resulting file to an S3 folder on a schedule.

Before you set up these scripts it would be useful to have your destination S3 bucket set up and configured with an IAM user that only has write access to the bucket. When deploying these scripts you'll need:
- S3 Bucket name
- the bucket's [S3 Region](https://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region)
- IAM User Access key ID
- IAM User's Access key secret

## Saved Searches
Saved Searches are run and saved as CSV files.
For formula and summary fields we recommend entering a custom column label
The saved search must be set to Public in order to be selected as a script parameter.


## Installation

Install the following files at some location in your Netsuite account's Suitescripts folder. These should all be at the same level.
- kotnHandleS3Push.js
- kotnPushDeferredSearch.js
- kotnPushSavedSearch.js
- kotnVaultAPISecret.js
- oauthShim.json
- lib

### Create a scheduled script for managing the file generation process.
Select kotnPushSavedSearch.js

In order to work with the baked in script ids in the vaulting script give this script an id of `_kotn_push_search_s3`

The scheduled script needs the following parameters:

#### Default Preference
- Target Search, _custscript_kotn_s3_search_, List, Saved Search
- Use Timestamp, _custscript_kotn_s3_use_ts_, Checkbox; default this to checked if you want the filename of the pushed file to have a timestamp.
- Limit Lines, _custscript_kotn_s3_lines_, Integer; this would be used in case the results need to be truncated at some maximum number of lines
- S3 Folder, _custscript_kotn_s3_folder_, Free-Form Text; If this has a value it should include the leading / (e.g., /transfer) but should be blank if files are transferred to the top level of the bucket.
- Deferred Search Storage Folder, _custscript_kotn_s3_defer_folder_, Free-Form Text; This will be the folder where large files are staged for pushing to S3 when the search is complete
- Deferred Script Deployment, _custscript_kotn_s3_defer_dep_, Free-Form Text; This will be the deployment id of a scheduled script that takes a finished saved search from the Deferred Search Storage Folder and pushes it to S3. When the search being managed will result in a 'large' file then the _Deferred X_ parameters may be used to handle pushing the file so that the script doesn't fail due to Netsuite's script governance. The deployment ids for this field should come from deployments of the __Push Deferred Search to S3__ script described below.
- Enable in Sandbox, _custscript_kotn_s3_enable_in_sandbox_, Checkbox; Check this if you want to test the scheduled script in a sandbox environment.

#### Company Preference
To aid management with multiple deployments make these parameters company preference.
- S3 Region, _custscript_kotn_s3_region_, Free-Form Text; The region of the bucket [see S3 Regions](https://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region)
- S3 Bucket, _custscript_kotn_s3_bucket_, Free-Form Text; The simple bucket name -- not the ARN.
- S3 Key, _custscript_kotn_s3_key_, Free-Form Text; the access key for the user you've set up with write access to the bucket
- S3 Secret, _custscript_kotn_s3_secret_, Free-Form Text; the access secret GUID for the S3 user.

When you save the script definition you can enter your S3 configuration.
- open Setup -> Company -> General Preferences in a new tab
- find the Custom Preferences tab
- Enter S3 Region, S3 Bucket and S3 Access Key
- *if you installed the bundle* then, in a new tab, open Setup -> Integration -> Vault Deep Channel S3 secret.
- *if you are installing the code* in a new tab complete the **Create a Suitelet** section and open the deployed suitelet URL
- paste your IAM user access key secret into the Suitelet form's Token field.
- click 'Store Secret'
- copy the Vaulted GUID value on the next page and paste it into the 'S3 Secret' parameter field on the custom preferences tab of the General Preferences page

### Deploy the Scheduled Script
Go back to the scheduled script tab and deploy the script.
- select a saved search to use to be pushed to S3
- check or uncheck the "Append Timestamp to Name"
- set an S3 Folder path. Leave blank for the top level but start any real path with a forward slash _e.g, /test_
- you can save and run the scheduled script and verify the saved search is converted to a CSV in your S3 bucket.
- once verified you can schedule your script deployment on whatever frequency is recommended by Deep Channel.

### Create 'Push Deferred Search to S3' a scheduled script for pushing large files to S3.
Select kotnPushDeferredSearch.js

In order to work with the baked in script ids in the vaulting script give this script an id of `_kotn_s3_defer_transfer`

The scheduled script needs the following parameters:

#### Default Preference
- S3 Folder, _custscript_kotn_deferred_s3_folder_, Free-Form Text;
- Search Results File, _custscript_kotn_deferred_s3_file_, Free-Form Text;
- Enable in Sandbox, _custscript_kotn_s3d_enable_in_sandbox_, Checkbox; Check this if you want to test the scheduled script in a sandbox environment.

Both of these may be left blank if this script's deployments will only be used with the `kotnPushSavedSearch.js` script.

It is recommended that each deployment of the standard push script that anticipates a large file be paired with a unique deployment of this script.

### Create a suitelet
- Select kotnVaultAPISecret.js and create a suitelet. The bundle includes a link for this suitelet under the Setup -> Integration path.
- Deploy this script. You may only need this script once. Once you have saved a Test deployment you can open the key vaulting page by clicking the URL link.
