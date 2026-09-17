const path = require('path');

// Builds a single UMD bundle you can host and register on a uiConf.
// KalturaPlayer is provided by the player at runtime, so it's marked external —
// the bundle must NOT ship its own copy of the player core.
module.exports = {
  entry: './src/document-pip.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'playkit-document-pip.js',
    library: 'PlaykitDocumentPip',
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  externals: {
    // The global KalturaPlayer object is present when the player bundle loads.
    'kaltura-player-js': {
      root: 'KalturaPlayer',
      commonjs: 'kaltura-player-js',
      commonjs2: 'kaltura-player-js',
      amd: 'kaltura-player-js'
    }
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: { loader: 'babel-loader' }
      }
    ]
  }
};
