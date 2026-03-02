module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: { node: 'current' },
        modules: false,
        bugfixes: true,
      },
    ],
    [
      '@babel/preset-typescript',
      {
        allowDeclareFields: true,
        onlyRemoveTypeImports: true,
      },
    ],
    '@babel/preset-react',
  ],
  plugins: [
    ['@babel/plugin-transform-runtime', { regenerator: true }],
    '@babel/plugin-transform-class-properties',
    '@babel/plugin-transform-class-static-block',
    '@babel/plugin-proposal-object-rest-spread',
    ['@babel/plugin-syntax-import-meta'],
  ],
};
