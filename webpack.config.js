const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const { BridgeWatchPlugin } = require('./scripts/bridge-watch-plugin');
const fs = require('fs');
const dotenv = require('dotenv');
const { buildSeoConfig } = require('./scripts/buildSeoConfig');
const { SeoAssetsWebpackPlugin } = require('./scripts/seo-assets-webpack-plugin');
const { BUILD_INFO, getBridgeCartFilename } = require('./scripts/buildInfo');

const envPath = path.join(__dirname, '.env');
const envLocalPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const SEO = buildSeoConfig(process.env);

// This is the main configuration object.
// Here, you write different options and tell Webpack what to do
module.exports = {

  // Path to your entry point. From this file Webpack will begin its work
  entry: './src/index.tsx',

  // Path and filename of your result bundle.
  // Webpack will bundle all JavaScript into this file
  output: {
    filename: "bundle.[contenthash].js",
    path: path.resolve(__dirname, "dist"),
    publicPath: "",
    clean: true,
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
      title: SEO.title,
      template: 'index.html',
      seo: SEO,
    }),
    new HtmlWebpackPlugin({
      filename: 'tic80-iframe-shell.html',
      template: 'public/tic80-iframe-shell.html',
      inject: false,
      bridgeCartFilename: getBridgeCartFilename(BUILD_INFO),
    }),
    new MiniCssExtractPlugin({
        filename: "[name].[contenthash].css",
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "public", // source folder
          to: ".",        // copy into dist root (default output.path)
          globOptions: {
            ignore: [
              '**/robots.txt',
              '**/sitemap.xml',
              '**/tic80-iframe-shell.html',
            ],
          },
        },
      ],
    }),
    new SeoAssetsWebpackPlugin(SEO),
    new webpack.DefinePlugin({
      BUILD_INFO: JSON.stringify(BUILD_INFO),
    }),
    new BridgeWatchPlugin({
      bridgeDir: path.resolve(__dirname, 'bridge'),
    }),
  ],

  // Default mode for Webpack is production.
  mode: 'development'
};
