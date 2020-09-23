Usually a virus scanner is very time sensitive, so it's important to benchmark it to know how it will affect your infrastructure.

I provide a very janky benchmarking script that I used to gain insight into how using mousetrap will affect my infrastructure.

The script is meant to be run from inside AWS - so most likely an ec2 instance or the sort. You want this to be ran from where you will eventually run mousetrap - so if you plan on running it on Kubernetes, it's probably better to run it from a Kubernetes pod running on ec2 than directly from an ec2 instance.

The script can test `local` and `s3` scanning.

Use `local` to see how fast clamav runs on your instance - some instance types are more suitable for clamav than others, using `local`, you can see how fast clamav scans a 10, 100 and 1000mb files.
Run `local` on several instance types to see which provides the fastest results for the price you're willing to pay.

Use `S3` to check your region's network speed and to see a close-to-real-life latency of using mousetrap. Using `S3` will simulate how mousetrap will actually function in day-to-day operation.
`S3` will stream a 10, 100 and 1000mb file from s3 into clamav.

Use a both `local` and `S3` to gain a better understanding of which instance type to use and how much additional latency the scanning will result in.

Examples:

### Local
```bash
node ./benchmark/benchmark.js --local
```

```bash

```


### S3
The script expects 3 files named `dummy.10.csv`, `dummy.100.csv` & `dummy.1000.csv` to be present in the root directory of the bucket.

Use `generate_dummy_data.js` to create all 3 files and upload them to your source bucket.

```bash
node ./benchmark/benchmark.js --s3 --bucket <bucket_name>
```

```bash

```


### Both
```bash
node ./benchmark/benchmark.js --local --s3 --bucket <bucket_name>
```