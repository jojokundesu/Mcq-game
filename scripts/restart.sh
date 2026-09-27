#!/bin/bash
pkill -f 'node server' 2>/dev/null
sleep 1
cd /home/user/Mcq-game
setsid nohup node server.js >/tmp/mq.log 2>&1 < /dev/null &
sleep 2
cat /tmp/mq.log
