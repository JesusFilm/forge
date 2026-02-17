import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig) =>
  mergeConfig(config, {
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  });
