# **Mousetrap**

[Docker hub](https://hub.docker.com/r/totangolabs/mousetrap)

A scaleable, resilient anti-virus designed for cloud workloads, based on ClamAV.

Currently supported clouds:
* AWS

# QUICK START
Start a ClamAV instance using docker
`docker run -d -p 3310:3310 -e CLAMD_CONF_MaxFileSize=2000M -e CLAMD_CONF_StreamMaxLength=2000M -e CLAMD_CONF_MaxScanSize=2000M mk0x/docker-clamav`

Configure Mousetrap
```yaml
general:
    port: 3000
    scanTimeout: 3600
    markStaleAfter: 4000
    pollingInterval: 5
    # maxScanAttempts: -1 # not yet implemented
clamd:
    host: localhost
    port: 3310
storage: s3
dynamodb:
    tableName: mousetrap-tasks
    region: us-east-1
sqs:
    url: "https://sqs.us-east-1.amazonaws.com/123456789/mousetrap-tasks"
    pollingInterval: 20
    visibilityTimeout: 30
    region: us-east-1
```

Start Mousetrap
`npm run prod`

Scan a file in a bucket using either SQS
`aws sqs send-message --queue-url https://sqs.us-east-1.amazonaws.com/123456789/mousetrap-tasks --message-body '{"filePath": "s3://bucket/file.csv"}'`

or the rest api
```bash
curl --location --request POST 'localhost:3000/api/tasks' \
    --header 'Content-Type: application/json' \
    --data-raw '{
        "filePath": "s3://bucket/file.csv"
    }'
```

# SCANNING FILES
## Putting files to be scanned
You can put files to be scanned by either using an SQS queue, or through the REST API (both documented below).

## Checking results
At any point you can query the REST API for the status of a specific file (documented below), it's status will be one of either:
* `PENDING` - wasn't picked up by a worker yet and hasn't been scanned
* `SCANNING` - a worker is currently scanning the file
* `FINISHED` - a worker has finished scanning the file
* `FAILED` - the file could not be scanned for any reason

When a file has been scanned a few things happen:
1. The file is marked as `FINISHED` in the database, and can be queried though the REST API
2. Two tags: `MOUSETRAP_RESULT` & `MOUSETRAP_TS` are added to the file in the bucket
3. (optionally) An SNS notification is sent to a channel

# CONFIGURATION
These are the options that are currently supported:
```yaml
general:
    port: 3000
    scanTimeout: 3600
    markStaleAfter: 4000
    pollingInterval: 5
    # maxScanAttempts: 5 # not yet implemented
clamd:
    host: localhost
    port: 3310
storage: s3 # supports only s3 currently
dynamodb:
    tableName: mousetrap-scan-tasks
    region: us-east-1
sqs:
    url: "https://sqs.us-east-1.amazonaws.com/123456789/mousetrap-tasks"
    pollingInterval: 20
    visibilityTimeout: 30
    region: us-east-1
sns:
    topicArn: "arn:aws:sns:us-east-1:123456789:mousetrap-notifications"
    region: us-east-1
```

# SNS
You can configure mousetrap to send a notification for every scan result.

The topic you specify in the configuration will receive a notification for **every** scan performed.
You can also specify a topic through the task payload when putting a task to be scanned:

Add a `notifyChannels` key to the payload:
```json
{ "filePath":"s3://bucket/file.csv", "notifyChannels": ["arn:aws:sns:us-east-1:123456789:mousetrap-notifications"] }
```

The message payload is a json document that looks like this:
```json
{
    "filePath":"s3://mousetrap-files/report.csv",
    "scanResult":"CLEAN",
    "viruses":[],
    "timestamp":1594983711402
}
```

or like so in case of an error:
```json
{
    "filePath":"s3://mousetrap-files/report.csv",
    "error": {
        "code": "FILE_NOT_EXIST",
        "message": "file does not exist in specified location"
    },
    "timestamp":1594983711402
}
```

# SQS
While you can put a file to be scanned using a REST api, it is highly recommended that youuse a queue for resiliency instead.

The expected body is exactly the same as using the REST api, i.e:
```json
{ "filePath": "s3://<bucketName>/<pathToFile>" }
```

# REST API
**Get list of pending & scanning tasks**
----
Returns a current snapshot of all pending & scanning tasks, as well as which task this particular worker is scanning at the time of querying.

* **URL:** `/api/tasks`

* **Method:** `GET`

* **Success Response:**
  
  `currentTask` specifies the task this particular worker is scanning.

  Should you query a worker that is idle, `currentTask` will be `null`.

  * **Code:** 200 <br />
    **Content:** 
    ```json
    {
        "status": "success",
        "data": {
            "currentTask": [
                {
                    "scanResult": "PENDING",
                    "viruses": [],
                    "scanEndTs": -1,
                    "sizeMb": 1073.07328414917,
                    "scanAttempts": 0,
                    "scanStartTs": 1594936370438,
                    "createdTs": 1594928147834,
                    "scanState": "SCANNING",
                    "filePath": "s3://bucket/file.csv",
                    "fileHash": "6b378f6bb00613a4b8192cfb3d805d9d-68"
                }
            ],
            "scanning": [
                {
                    "scanResult": "PENDING",
                    "viruses": [],
                    "scanEndTs": -1,
                    "sizeMb": 1073.07328414917,
                    "scanAttempts": 0,
                    "scanStartTs": 1594936370438,
                    "createdTs": 1594928147834,
                    "scanState": "SCANNING",
                    "filePath": "s3://bucket/file.csv",
                    "fileHash": "6b378f6bb00613a4b8192cfb3d805d9d-68"
                }
            ],
            "pending": []
        }
    }
    ```

* **Sample Call:**

  `curl --location --request GET 'localhost:3000/api/tasks'`



**Get a specific task status**
----

* **URL:** `/api/tasks/:filePath`

* **Method:**

  `GET`

* **Success Response:**

  * **Code:** 200 <br />
    **Content:** 
    ```json
    {
        "status": "success",
        "data": {
            "task": {
                "scanResult": "INFECTED",
                "viruses": [
                    "Win.Test.EICAR_HDB-1"
                ],
                "scanEndTs": 1594924786399,
                "sizeMb": 0.000064849853515625,
                "scanAttempts": 1,
                "scanStartTs": 1594924784450,
                "createdTs": 1594927820899,
                "scanState": "FINISHED",
                "filePath": "s3://bucket/eicar.com.txt",
                "fileHash": "44d88612fea8a8f36de82e1278abb02f"
            }
        }
    }
    ```
 
* **Error Response:**

  * **Code:** 404 NOT FOUND

* **Sample Call:**

  `curl --location --request GET 'localhost:3000/api/tasks/s3://bucket/eicar.com.txt'`



**Get specific task status**
----

* **URL:** `/api/tasks`

* **Method:**

  `POST`

* **Data Params**
  
  **Required**: `filePath`

  **Optional**: `notifyChannels`

  ```json
  {
      "filePath": "s3://<bucketName>/<pathToFile>",
      "notifyChannels": [ "arn:aws:sns:us-east-1:123456789:mousetrap-notifications" ] // any valid notifications provider
  }
  ```

* **Success Response:**

  * **Code:** 200
 
* **Error Response:**

  * When body is malformed <br />
    **Code:** 400<br />
    **Content:**
    ```json
    {
        "status": "fail",
        "data": {
            "message": "no 'filePath' in body",
            "requestId": "0bfbd02e-84a7-4d5e-a887-3f42cd059a34"
        }
    }
    ```
  
  OR

  * When file does not exist in location <br />
  **Code:** 422 <br />
  **Content:**
    ```json
    {
        "status": "fail",
        "data": {
            "message": "file does not exist in specified location",
            "code": "FILE_NOT_EXIST",
            "requestId": "bc79b594-23ea-4e8b-a809-0f05d305b18c"
        }
    }
    ```

* **Sample Call:**

  ```bash
    curl --location --request POST 'localhost:3000/api/tasks' \
    --header 'Content-Type: application/json' \
    --data-raw '{
        "filePath": "s3://bucket/file.csv"
    }'
  ```

# Performance
Bear in mind, how your infrastructure looks may vary from ours over at Totango, but this should give you an estimate for the performance you can expect:

```
10mb: 1031ms
100mb: 8840ms
1000mb: 56995ms - 94773ms # large files have seen the most amount of variation
                          # once i'll have a larger sample of files ill update with an average
```

This was in us-east-1, mousetrap and clamav running in a Kubernetes cluster, in the same pod on the same node.

Mousetrap having 0.5 a core and 800mb of memory.
Clamav having 1 core and 2300mb of memory.

I dont know if this affects performance, but ClamAV ran with these env vars:
```
CLAMD_CONF_MaxFileSize=2000M
CLAMD_CONF_StreamMaxLength=2000M
CLAMD_CONF_MaxScanSize=2000M
```

# Contributing
## Bug Reports & Feature Requests

Please use the issue tracker to report any bugs or file feature requests.

## Developing

If you are interested in being a contributor and want to get involved in developing this project shoot us an email at ops@totango.com

In general, PRs are welcome. We follow the typical "fork-and-pull" Git workflow.

1. **Fork** the repo on GitHub
2. **Clone** the project to your own machine
3. **Commit** changes to your own branch
4. **Push** your work back up to your fork
5. Submit a **Pull Request** so that we can review your changes

NOTE: Be sure to merge the latest changes from "upstream" before making a pull request!