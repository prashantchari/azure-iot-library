/* Copyright (c) Microsoft Corporation. All Rights Reserved. */
/* Copyright (c) Microsoft Corporation. All Rights Reserved. */

import * as azureStorage from 'azure-storage';
import * as fswatcher from 'chokidar';
import { access, F_OK, readFile } from 'fs';
import { getVal } from './getVal';
import { IConfiguration } from './IConfiguration';

const fileFoundMsg: string = 'User config file found';
const fileReadingErrMsg: string =
    'User config file found but unable to be read';
const fileNotFoundMsg: string =
    'No user config file found - using environment variables or ' +
    'configuration service instead';

export class FileConfiguration implements IConfiguration {
    private fileConfig: { [key: string]: any } = {};

    /**
     * Asynchronously initialize configuration values from the passed file.
     *
     * @param {string} configFilename - Name of the JSON file containing
     * configuration preferences.
     */
    public async initialize(configFilename: string, storageConnectionString: string = '', logger: Function = console.log): Promise<void> {
        logger = logger || console.log;
        if (storageConnectionString) {
            const fileConfigPromise = new Promise<string>((resolve, reject) => {
                let blobService = new azureStorage.BlobService(storageConnectionString);
                let containerName = configFilename.split('/')[0];
                let regexp = new RegExp(`^${containerName}\/`);
                let blobName = configFilename.replace(regexp, '');
                blobService.getBlobToText(containerName, blobName, (error, text) => {
                    if (error)
                        reject();
                    resolve(text);
                });
            }).catch((errMsg) => {
                throw new Error(fileReadingErrMsg);
            });
            this.fileConfig = JSON.parse(await fileConfigPromise);
        }
        else {
            try {
                await this.checkFileExistence(configFilename);
            } catch (err) {
                logger(fileNotFoundMsg);
                return;
            }

            // Attempt to read file
            logger(fileFoundMsg);
            this.fileConfig = JSON.parse(await this.loadFile(configFilename));

            // add a watcher for the file
            const watcher = fswatcher.watch(configFilename, {awaitWriteFinish: true});
            watcher.on('change', async (path, stats) => {
                // re-load the config
                try {
                    this.fileConfig = JSON.parse(await this.loadFile(configFilename));
                } catch (error) {
                    // stay with the last config in case of exceptions
                    logger(`${fileReadingErrMsg} - ${error.toString()}`);
                }
            });
        }
    }

    private async loadFile(configFilename: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            readFile(configFilename, 'utf8', (err, result) => {
                if (err) {
                    reject(err);
                }
                resolve(result);
            });
        }).catch((errMsg) => {
            throw new Error(fileReadingErrMsg);
        });
    }

    private async checkFileExistence(configFilename: string): Promise<void> {
        let fileExistence = new Promise<void>((resolve, reject) => {
            access(configFilename, F_OK, (err) => {
                err ? reject(err) : resolve();
            });
        });

        await fileExistence;
    }

    /**
     * Get the value associated with the passed key.
     *
     * Returns null if no value is set.
     *
     * Throw an error if the keyed value type is not a string.
     *
     * @param {string | string[]} key - Name of the variable to get.
     * @return {string} Value of variable named by key.
     */
    public getString(key: string | string[]): string {
        let val: any = getVal(key, this.fileConfig);
        if (typeof val !== 'string' && val !== null) {
            // try to stringify first
            try {
                return JSON.stringify(val);
            } catch (err) {
                throw new Error(
                    `Configuration service found value for ${key} that was not a string.`);
            }
        }
        return val;
    }

    /**
     * Get the value associated with the passed key.
     *
     * Returns null if no value is set.
     *
     * @param {string | string[]} key - Name of the variable to get.
     * @return {T} Value of variable named by key.
     */
    public get<T>(key: string | string[]): T {
        let val: any = getVal(key, this.fileConfig);
        return val as T;
    }
}
