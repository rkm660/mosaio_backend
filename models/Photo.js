const mongoose = require('mongoose');

let PhotoSchema = new mongoose.Schema({
    instagramID: String,
    userName: String,
    userID: String,
    isVideo: Boolean,
    originalURL: String,
    date: Number,
    originalSrc: String,
    originalWidth: Number,
    originalHeight: Number,
    thumbnailSrc: String,
    thumbnailWidth: Number,
    thumbnailHeight: Number,
    previewSrc: String,
    previewWidth: Number,
    previewHeight: Number,
    caption: String,
    numLikes: Number,
    medH: Number,
    medS: Number,
    medL: Number,
    stdDev: Number,
    fileIndex: Number,
    batchNumber: Number
});

module.exports = mongoose.model('Photo', PhotoSchema);