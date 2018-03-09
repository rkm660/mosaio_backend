const mongoose = require('mongoose');

let MosaicSchema = new mongoose.Schema({
    inputImg: String,
    inputURL: String,
    originalWidth: Number,
    originalHeight: Number,
    resizedWidth: Number,
    resizedHeight: Number,
    resizedPixelDict: Object,
    mosaicMatrix: Object,
    status: String,
    progress: Number,
    timestampQueued: Date,
    timestampInitialized: Date,
    timestampFinished: Date
});

module.exports = mongoose.model('Mosaic', MosaicSchema);