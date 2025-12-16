module.exports = {
  apps : [{
    name: "recipe-api",
    script: "./dist/index.js",
    instances: 1,
    exec_mode: "fork",
    env: {
      "PORT": 3034,
      "NODE_ENV": "production",
    },
    max_memory_restart: "500M",
  }, {
    name: "recipe-worker",
    script: "./dist/worker.js",
    instances: 4, // Run 4 workers, one per CPU
    exec_mode: "fork", // Use fork mode for individual instance management
    env: {
      "NODE_ENV": "production",
    },
    max_memory_restart: "1500M", // 1.5GB per worker
    // Pass an index to each worker to create unique storage directories
    env_0: {
      "INSTANCE_ID": "0",
    },
    env_1: {
      "INSTANCE_ID": "1",
    },
    env_2: {
      "INSTANCE_ID": "2",
    },
    env_3: {
      "INSTANCE_ID": "3",
    }
  }, {
    name: "recipe-auditor",
    script: "./dist/auditor.js",
    instances: 1,
    exec_mode: "fork",
    env: {
      "NODE_ENV": "production",
    },
    max_memory_restart: "500M",
  }]
};
