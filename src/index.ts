import { Hono } from 'hono';
import { MongoClient } from 'mongodb';
import { CronJob } from 'cron';

const mongo_uri = process.env.MONGO_URI!;

const client = new MongoClient(mongo_uri);
const database = client.db('iotdata');
const devices = database.collection('devices');


const isNumeric = (string: string) => /^[+-]?\d+(\.\d+)?$/.test(string)

const job = new CronJob('0 */1 * * * *', async () => {
  try {
    const temp_history = database.collection('temp_history');
    const history = database.collection('history');
    
    // Get the current minute rounded down
    const currentMinute = new Date();
    currentMinute.setSeconds(0);
    currentMinute.setMilliseconds(0);

    // Get all records from temp_history
    const records = await temp_history.find({}).toArray();

    // Group records by device_id and stat
    const groupedRecords = records.reduce((acc, record) => {
      const key = `${record.device_id}/${record.stat}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(record);
      return acc;
    }, {} as Record<string, any[]>);

    // Process each group
    for (const [key, values] of Object.entries(groupedRecords)) {
      const [device_id, stat] = key.split('/');
      
      // Check if values are numeric
      const isNumber = values.every(v => isNumeric(v.value));
      
      let finalValue;
      if (isNumber) {
        // Calculate average for numeric values
        const numericValues = values.map(v => parseFloat(v.value));
        const averageValue = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
        finalValue = averageValue.toFixed(2);
      } else {
        // For non-numeric values, use the most recent value
        const latestRecord = values.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )[0];
        finalValue = latestRecord.value;
      }

      // Create consolidated history entry
      const historyEntry = {
        device_id,
        stat,
        timestamp: currentMinute,
        value: finalValue,
        samples: values.length
      };

      // Insert into history collection
      await history.insertOne(historyEntry);
    }

    // Clear temp_history collection
    await temp_history.deleteMany({});

    console.log(`Processed ${records.length} temporary records at ${currentMinute.toISOString()}`);
  } catch (error) {
    console.error('Error processing history:', error);
  }
});

// Start the job
job.start();

type EMQXMessage = {
  username: string,
  topic: string,
  timestamp: number,
  qos: number,
  publish_received_at: number,
  pub_props: object,
  peerhost: string,
  payload: string,
  node: string,
  metadata: object,
  id: string,
  flags: object,
  event: string,
  clientid: string
}
const app = new Hono()
  .post('/emqx/ingest',
    async (c) => {

      const emqx_message = await c.req.json() as EMQXMessage;
      const topic_split = emqx_message.topic.split('/');
      const device_id = emqx_message.clientid;
      const stat = topic_split[topic_split.length - 1];
      const filter = {
        device_id: device_id,
      }
      const update = {
        $set: {
          last_seen: new Date(),
          [`stats.${stat}`]: emqx_message.payload
        }
      }
      const result = await devices.updateOne(filter, update);
      // add to history collection
      const history = database.collection('temp_history');
      const history_entry = {
        device_id: device_id,
        stat: stat,
        timestamp: new Date(),
        value: emqx_message.payload
      }
      const result2 = await history.insertOne(history_entry);

      console.log(`Received message from ${device_id} with stat ${stat} and value ${emqx_message.payload}`);
      return c.text('OK');
    })
  .post('/emqx/firmware',
    async (c) => {
      const emqx_message = await c.req.json() as EMQXMessage;
      const device_id = emqx_message.clientid;
      const firmware_version = emqx_message.payload;
      const filter = {
        device_id: device_id,
      }
      const update = {
        $set: {
          last_seen: new Date(),
          fw_version: firmware_version
        }
      }
      const result = await devices.updateOne(filter, update);
      console.log(`Received firmware version from ${device_id}: ${firmware_version}`);
      return c.text('OK');
    })

export default app;