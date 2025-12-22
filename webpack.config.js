// Webpack uses this to work with directories
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const childProcess = require('child_process');
const { BridgeWatchPlugin } = require('./scripts/bridge-watch-plugin');

function safeExec(command) {
  try {
    return childProcess.execSync(command, { encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

function getBuildInfo() {
  const gitTag = safeExec('git describe --tags --abbrev=0');

  let commitsSinceTag = null;
  if (gitTag) {
    const count = safeExec(`git rev-list ${gitTag}..HEAD --count`);
    commitsSinceTag = count != null ? parseInt(count, 10) : null;
  }

  const dirtyOutput = safeExec('git status --porcelain');
  const dirty = dirtyOutput == null ? null : dirtyOutput.length > 0;

  const commitHash = safeExec('git rev-parse --short HEAD');
  const lastCommitDate = safeExec('git log -1 --format=%cI');
  const buildDate = new Date().toISOString();

  return {
    gitTag,
    commitsSinceTag,
    dirty,
    buildDate,
    lastCommitDate,
    commitHash,
  };
}

const BUILD_INFO = getBuildInfo();

// This is the main configuration object.
// Here, you write different options and tell Webpack what to do
module.exports = {

  // Path to your entry point. From this file Webpack will begin its work
  entry: './src/index.tsx',

  // Path and filename of your result bundle.
  // Webpack will bundle all JavaScript into this file
  output: {
    path: path.resolve(__dirname, 'dist'),
    publicPath: '',
    filename: 'bundle.js'
  },

  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
      {
        test: /\.lua$/,
        use: 'raw-loader',
      },
      {
        test: /\.jsonc$/,
        type: 'javascript/auto',
        use: {
          loader: path.resolve(__dirname, 'scripts/jsonc-loader.js'),
        },
      },
      {
        test: /\.([jt])sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              "@babel/preset-env",
              [
                "@babel/preset-react",
                { runtime: "automatic" }
              ],
              "@babel/preset-typescript"
            ],
          },
        },
      },
    ],
  },

  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },

  plugins: [
    new HtmlWebpackPlugin({
      title: 'Somatic',
      template: 'index.html',
    }),
    new MiniCssExtractPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "public", // source folder
          to: ".",        // copy into dist root (default output.path)
        },
      ],
    }),
    new webpack.DefinePlugin({
      BUILD_INFO: JSON.stringify(BUILD_INFO),
    }),
    new BridgeWatchPlugin({
      bridgeDir: path.resolve(__dirname, 'bridge'),
    }),
  ],

  // Default mode for Webpack is production.
  // Depending on mode Webpack will apply different things
  // on the final bundle. For now, we don't need production's JavaScript 
  // minifying and other things, so let's set mode to development
  mode: 'development'
};
