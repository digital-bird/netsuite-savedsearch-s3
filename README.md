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
- kotnPushSavedSearch.js
- kotnVaultAPISecret.js
- oauthShim.json
- lib

### Create a scheduled script.
Select kotnPushSavedSearch.js

In order to work with the baked in script ids in the vaulting script give this script an id of `_kotn_push_search_s3`

The scheduled script needs the following parameters:

#### Default Preference
- Target Search, custscript_kotn_s3_search, List, Saved Search
- Use Timestamp, custscript_kotn_s3_use_ts, Checkbox; default this to checked if you want the filename of the pushed file to have a timestamp.
- Limit Lines, custscript_kotn_s3_lines, Integer; this would be used in case the results need to be truncated at some maximum number of lines
- S3 Folder, custscript_kotn_s3_folder, Free-Form Text; If this has a value it should include the leading / (e.g., /transfer) but should be blank if files are transferred to the top level of the bucket.

#### Company Preference
To aid management with multiple deployments make these parameters company preference.
- S3 Region, custscript_kotn_s3_region, Free-Form Text; The region of the bucket [see S3 Regions](https://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region)
- S3 Bucket, custscript_kotn_s3_bucket, Free-Form Text; The simple bucket name -- not the ARN.
- S3 Key, custscript_kotn_s3_key, Free-Form Text; the access key for the user you've set up with write access to the bucket
- S3 Secret, custscript_kotn_s3_secret, Free-Form Text; the access secret GUID for the S3 user.

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

### Create a suitelet
- Select kotnVaultAPISecret.js and create a suitelet. The bundle includes a link for this suitelet under the Setup -> Integration path.
- Deploy this script. You may only need this script once. Once you have saved a Test deployment you can open the key vaulting page by clicking the URL link.
