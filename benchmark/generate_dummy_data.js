const generate = require('csv-generate')
const fs = require('fs');
const dummy10 = fs.createWriteStream("./dummy.10.csv");
const dummy100 = fs.createWriteStream("./dummy.100.csv");
const dummy1000 = fs.createWriteStream("./dummy.1000.csv");

console.log("Creating dummy data files...");

generate({
        columns: ['int', 'bool'],
        length: 60000 * 10 // 60 k lines is about 1mb
    })
    .pipe(dummy10)

generate({
        columns: ['int', 'bool'],
        length: 60000 * 100
    })
    .pipe(dummy100)

generate({
        columns: ['int', 'bool'],
        length: 60000 * 1000
    })
    .pipe(dummy1000)