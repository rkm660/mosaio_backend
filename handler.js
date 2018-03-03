'use strict';

const fs = require('fs');
const mongoose = require('mongoose');
const config = require('./config.js')
const utils = require('./utils.js');
const main = require('./controllers/main.js');
const AWS = require('aws-sdk');
const utf8 = require('utf8');

// misc config
let awsConfig = new AWS.Config({
    correctClockSkew: true
});

let stepFunctions = new AWS.StepFunctions(awsConfig);

mongoose.Promise = global.Promise;

// step 1
module.exports.validate = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
        if (!body.rawURL) {
            callback(new Error("Request must contain rawURL."), utils.createErrorResponse(501, "Request must contain rawURL."));
        }
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    db.once('open', () => {

        // validate input URL
        main.validateInputURL(body.rawURL)
            .then((validatedURLObject) => {
                let inputImg = validatedURLObject['inputImg'];
                let inputURL = validatedURLObject['inputURL'];
                let error = validatedURLObject['error'];

                // some problem with the input URL
                if (error) {
                    callback(error, utils.createErrorResponse(501, error));
                    db.close();
                } else {
                    // check for duplicate mosaic
                    main.checkDuplicateMosaic(inputURL).then((mosaic) => {
                        // mosaic object already exists
                        if (mosaic) {
                            callback(null, utils.createValidResponse({ '_id': mosaic['_id'] }));
                        }
                        // return normalized url and img src
                        else {
                            callback(null, utils.createValidResponse({ '_id': null, 'inputImg': inputImg, 'inputURL': inputURL }));
                        }
                        db.close();
                    }).catch((err) => {
                        // error in checking for duplicate mosaic in DB
                        callback(err, utils.createErrorResponse(err.statusCode, err.message));
                        db.close();
                    })
                }
            }).catch((err) => {
                // error in validating input URL
                callback(err, utils.createErrorResponse(err.statusCode, err.message));
                db.close();
            });
    });
}

// step 2
module.exports.create = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }
    db.once('open', () => {
        // mosaic object already exists
        if (body._id !== null) {
            callback(null, utils.createValidResponse(Object.assign({}, { _id: body._id })));
            db.close();
        } else {
            // create mosaic object locally, then in DB
            main.createLocalMosaicObject(body.inputImg, body.inputURL).then((localMosaicObject) => {
                main.createExternalMosaicObject(localMosaicObject).then((externalMosaicObject) => {
                    callback(null, utils.createValidResponse(Object.assign({}, { _id: externalMosaicObject['_id'] })));
                    db.close();
                }).catch((err) => {
                    callback(err, utils.createErrorResponse(501, "Error creating DB object."));
                    db.close();
                });
            }).catch((err) => {
                callback(err, utils.createErrorResponse(501, "Error creating internal object."));
                db.close();
            });
        }
    });
}

// step 3
module.exports.init = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    let body;
    try {
        body = JSON.parse(event.body);
        if (!body._id) {
            callback(e, utils.createErrorResponse(501, "Request must contain _id."));
        }
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    // prepare input for execution obj
    let filteredInput = utf8.encode(JSON.stringify({ body: { _id: body._id } }));

    const params = {
        stateMachineArn: 'arn:aws:states:us-east-1:915961610259:stateMachine:createMosaic',
        input: filteredInput
    }

    db.once('open', () => {
        // start mosaic creation process
        main.getMosaicByID(body._id).then((mosaicObject) => {
            // mosaic exists and is completely assembled
            if (mosaicObject && mosaicObject['status'] == 'complete') {
                callback(null, utils.createValidResponse({ message: 'Mosaic is already created.' }));
                db.close();
            } else if (mosaicObject && mosaicObject['status'] == 'pending') {
                callback(null, utils.createValidResponse({ message: 'Mosaic is already being created.' }));
                db.close();
            } else {
                // begin mosaic execution thread
                stepFunctions.startExecution(params, (err, data) => {
                    if (err) {
                        callback(null, utils.createErrorResponse(501, 'There was an error in mosaic creation.'));
                    } else {
                        callback(null, utils.createValidResponse({ message: 'Mosaic creation initialized.' }));
                    }
                    db.close();
                })
            }
        });
    });
}

module.exports.assemble1 = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    db.once('open', () => {
        // start mosaic creation process
        main.getMosaicByID(event.body._id).then((mosaicObject) => {

            let matrix;

            if (mosaicObject["mosaicMatrix"] == null) {
                matrix = utils.createEmptyMatrix(mosaicObject['resizedWidth'], mosaicObject['resizedHeight']);
            } else {
                matrix = mosaicObject["mosaicMatrix"];
            }

            let height = Object.keys(mosaicObject['resizedPixelDict']).length;

            main.findClosestAll(event.body._id, mosaicObject['resizedPixelDict'], 0, 25, height, matrix).then((matrix) => {
                callback(null, utils.createValidResponse({ '_id': event.body._id }));
                db.close();
            })
        });
    });
}

module.exports.assemble2 = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;
    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    db.once('open', () => {
        // start mosaic creation process
        main.getMosaicByID(body._id).then((mosaicObject) => {
            let matrix;

            if (mosaicObject["mosaicMatrix"] == null) {
                matrix = utils.createEmptyMatrix(mosaicObject['resizedWidth'], mosaicObject['resizedHeight']);
            } else {
                matrix = mosaicObject["mosaicMatrix"];
            }

            let height = Object.keys(mosaicObject['resizedPixelDict']).length;

            main.findClosestAll(body._id, mosaicObject['resizedPixelDict'], 26, 50, height, matrix).then((matrix) => {
                callback(null, utils.createValidResponse({ '_id': body._id }));
                db.close();
            })
        });
    });
}

module.exports.assemble3 = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    db.once('open', () => {
        // start mosaic creation process
        main.getMosaicByID(body._id).then((mosaicObject) => {

            let matrix;

            if (mosaicObject["mosaicMatrix"] == null) {
                matrix = utils.createEmptyMatrix(mosaicObject['resizedWidth'], mosaicObject['resizedHeight']);
            } else {
                matrix = mosaicObject["mosaicMatrix"];
            }

            let height = Object.keys(mosaicObject['resizedPixelDict']).length;

            main.findClosestAll(body._id, mosaicObject['resizedPixelDict'], 51, 75, height, matrix).then((matrix) => {
                callback(null, utils.createValidResponse({ '_id': body._id }));
                db.close();
            })
        });
    });
}

module.exports.assemble4 = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    db.once('open', () => {
        // start mosaic creation process
        main.getMosaicByID(body._id).then((mosaicObject) => {

            let matrix;

            if (mosaicObject["mosaicMatrix"] == null) {
                matrix = utils.createEmptyMatrix(mosaicObject['resizedWidth'], mosaicObject['resizedHeight']);
            } else {
                matrix = mosaicObject["mosaicMatrix"];
            }

            let height = Object.keys(mosaicObject['resizedPixelDict']).length;

            main.findClosestAll(body._id, mosaicObject['resizedPixelDict'], 76, 100, height, matrix).then((matrix) => {
                callback(null, utils.createValidResponse({ '_id': body._id }));
                db.close();
            })
        });
    });
}

module.exports.assemble5 = (event, context, callback) => {
    const db = mongoose.connect(config.mongoURI).connection;

    // parse and validate request
    let body;
    try {
        body = JSON.parse(event.body);
    } catch (e) {
        callback(e, utils.createErrorResponse(501, "Error parsing request."));
    }

    db.once('open', () => {
        // start mosaic creation process
        main.getMosaicByID(body._id).then((mosaicObject) => {

            let matrix;

            if (mosaicObject["mosaicMatrix"] == null) {
                matrix = utils.createEmptyMatrix(mosaicObject['resizedWidth'], mosaicObject['resizedHeight']);
            } else {
                matrix = mosaicObject["mosaicMatrix"];
            }

            let height = Object.keys(mosaicObject['resizedPixelDict']).length;

            main.findClosestAll(body._id, mosaicObject['resizedPixelDict'], 101, height, height, matrix).then((matrix) => {
                callback(null, utils.createValidResponse({ '_id': body._id }));
                db.close();
            })
        });
    });
}