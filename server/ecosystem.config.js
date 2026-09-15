// 宝塔面板「Node 项目 / PM2 管理器」可直接用这份配置启动。
// 用法：cd /www/wwwroot/daily-carddraw-server && pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'daily-carddraw-server',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // 单实例即可；抽卡并发靠 MySQL 行锁保证，不需要多进程。
      autorestart: true,
      max_memory_restart: '300M',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
