/* Copyright (c) Microsoft Corporation. All Rights Reserved. */

import { readFile, access, F_OK } from 'fs';
import { IConfiguration } from './IConfiguration';
import { getVal } from './getVal';
import * as azureStorage from 'azure-storage';

const fileConsumedMsg: string = 'User config file found';
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
        // Check for file existence
        let fileConfigPromise;
        if (storageConnectionString) {
            fileConfigPromise = new Promise<string>((resolve, reject) => {
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
        }
        else {
            try {
                await this.checkFileExistence(configFilename);
            } catch (err) {
                logger(fileNotFoundMsg);
                return;
            }

            // Attempt to read file
            fileConfigPromise = new Promise<string>((resolve, reject) => {
                readFile(configFilename, 'utf8', (err, result) => {
                    if (err) {
                        reject(err);
                    }
                    logger(fileConsumedMsg);
                    resolve(result);
                });
            }).catch((errMsg) => {
                throw new Error(fileReadingErrMsg);
            });
        }
        let fileConfig: string = await fileConfigPromise;
        this.fileConfig = JSON.parse(fileConfig);
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
