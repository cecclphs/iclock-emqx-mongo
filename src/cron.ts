
import { CronJob } from 'cron';
import {MongoClient} from 'mongodb';

const mongo_uri = process.env.MONGO_URI!;

const client = new MongoClient(mongo_uri);
const database = client.db('iotdata');
const devices = database.collection('devices');


const isNumeric = (string: string) => /^[+-]?\d+(\.\d+)?$/.test(string)

const logStatKeys = ['temp', 'hum', 'lux', 'rssi']
const job = new CronJob('0 */2 * * * *', async () => {
  try {
    const temp_history = database.collection('temp_history');
    const history = database.collection('history');
    
    // Get the current minute rounded down
    const currentMinute = new Date();
    currentMinute.setSeconds(0);
    currentMinute.setMilliseconds(0);

    // Get all records from temp_history
    const records = await temp_history.find({ }).toArray();

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
      if (logStatKeys.includes(stat)) {
        // Insert into history collection
        await history.insertOne(historyEntry);
      }
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