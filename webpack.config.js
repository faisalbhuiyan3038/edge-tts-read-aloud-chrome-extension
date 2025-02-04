const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    popup: './popup/popup.ts',
    background: './background/background.ts',
    content: './content/content.ts',
    reader: './reader/reader.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name]/[name].js',
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      }
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.css'],
    fallback: {
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer/"),
      "util": require.resolve("util/"),
      "path": require.resolve("path-browserify")
    }
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "manifest.json", to: "manifest.json" },
        { from: "popup/popup.html", to: "popup/popup.html" },
        { from: "popup/popup.css", to: "popup/popup.css" },
        { from: "reader/reader.html", to: "reader/reader.html" },
        { from: "icons", to: "icons" }
      ],
    }),
  ],
};
