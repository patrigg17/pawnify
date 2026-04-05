module.exports = {
  apps: [{
    name: 'pawnify',
    script: 'src/server.js',
    cwd: '/var/www/vhosts/home-madrid.com/pawnify',
    node_args: '--max-old-space-size=256',
    out_file: '/dev/null',
    error_file: '/var/log/pawnify-error.log',
    time: true,
    autorestart: true,
    max_memory_restart: '300M',
    restart_delay: 4000,
    min_uptime: '10s',
    max_restarts: 10,
    exp_backoff_restart_delay: 100
  }]
};
