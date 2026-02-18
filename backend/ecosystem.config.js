module.exports = {
  apps: [{
    name: 'polymarket-bot',
    script: 'server.js',
    cwd: './backend',
    watch: false,
    max_memory_restart: '500M',
    restart_delay: 5000,
    max_restarts: 50,
    autorestart: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
