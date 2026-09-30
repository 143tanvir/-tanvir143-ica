// Local @tanvir143/ica adapter example for FCA-style bots
const login = require('@tanvir143/ica');

login({
  appState: require('./account-state.json'),
  autoReconnect: true,
  selfListen: true,
}, (err, api) => {
  if (err) throw err;

  api.listenMqtt((eventErr, event) => {
    if (eventErr) return console.error(eventErr);
    console.log(`[${event.threadID}] ${event.senderID}: ${event.body}`);
  });
});
