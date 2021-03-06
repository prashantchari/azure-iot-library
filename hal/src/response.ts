/* Copyright (c) Microsoft Corporation. All Rights Reserved. */

import * as express from 'express';
import * as halson from 'halson';
import * as url from 'url';

import {Server} from './server';
import {Template} from './template';
import {Rel, LinkRelation, Hal, Href} from './constants';
import {hal} from './decorators';

// Conditionally ensure this link or embed is an array, even if it's only a single item
function ensureArray<T>(set: { [rel: string]: T | T[] } = {}, rel: string, ensure?: boolean) {
    const value = set[rel];
    if (ensure && value && !(value instanceof Array)) {
        set[rel] = [value];
    }
}

// Log an error message for an unresolvable rel
function unresolvableRel(res: hal.Response, rel: Rel) {
    console.error(`Cannot find rel: ${Rel.stringify(Server.linker.normalize(_private(res).server, rel))}`);
}

// Provides HAL functionality to be embedded in an Express response object
export class Response implements hal.Response {
    // Generate a HAL response object, either for the root response object (if root and data are not specified),
    // or an embedded object (in the HAL sense) where root specified the root response and data the embedded body
    private static resource(resolved: hal.Overrides, root?: hal.Response, data?: any): hal.Response {
        let res = {};

        res[Response.Private] = {
            server: resolved.server,
            params: resolved.params,
            hal: halson(data || {}),
            root: root || res
        } as Response.Private;

        let resource = Object.assign(res, {
            link: Response.prototype.link.bind(res),
            embed: Response.prototype.embed.bind(res),
            docs: Response.prototype.docs.bind(res)
        });

        Response.initialize(resource, resolved, !!data);

        return resource;
    }

    // Merge a new HAL response object into the given Express response
    static create(server: Object, href: string, links: Rel[], req: express.Request, res: express.Response): express.Response & hal.Response {
        let resource = Response.resource({ server, href, links, params: req.params });
        return Object.assign(res, resource, {
            json: Response.prototype.json.bind(res, res.json.bind(res))
        });
    }

    // Initialize a new response object (acts as a constructor)
    private static initialize(response: hal.Response, resolved: hal.Overrides, template: boolean) {
        // Add all of the default links
        if (resolved.links) {
            for (const link of resolved.links) {
                if (link === LinkRelation.Self) {
                    _private(response).hal.addLink('self', template ? Template.link(resolved) : resolved.href!);
                } else {
                    response.link(link);
                }
            }
        }
    }

    // Provide a wrapper around the Express response's .json() method to return a HAL response
    json(original: (obj: any) => express.Response, data: any): express.Response {
        ensureArray(_private(this).hal._links, Rel.Curies, true);

        // This method will be bound to an (express.Response & hal.Response) object;
        // update the Express response to return the appropriate response type
        (this as any).type('application/hal+json');

        // HAL responses are just JSON objects with specified properties;
        // we create the actual response by merging in our JSON object
        return original(Object.assign(_private(this).hal, data));
    }

    // Resolve the given rel into fully-defined link objects
    static resolve(server: Object, rel: Rel, params: any, overrides: hal.Overrides): hal.Overrides[] {
        // Initialize the resolved link from the request
        let base: hal.Overrides = { rel, params, links: [], server: overrides.server || server };

        const links = Server.linker.getLinks(base.server!, base.rel!);

        // If the links failed to resolve, provide a dummy link object in order to ensure
        // that overrides can be proccessed
        return (links.length > 0 ? links : [{}]).map(link => {
            // Splice the automatic link resolution with the overrides
            let resolved = Object.assign({}, base, link, overrides);

            // Unless they were overridden, params should be a union of the provided params
            if (!overrides.params) {
                resolved.params = Object.assign({}, base.params, link.params);
            }

            // Resolve the real id from explicitly present params
            resolved.id = resolved.id && resolved.params[resolved.id];

            // Normalize the resolved rel; if it was overridden, bypass the server to prevent automatic namespacing
            resolved.rel = resolved.rel && Server.linker.normalize(overrides.rel ? {} : resolved.server || {}, resolved.rel);

            // If we are overriding with a URL object, splice it into the resolved href
            if (overrides.href && typeof overrides.href === 'object') {
                // Internally-resolved links are guaranteed to be strings;
                // we also need to resolve the params of the base href first,
                // to prevent conflict between Express and URI syntax
                resolved.href = Object.assign(url.parse(Template.apply(link.href! as string, resolved.params)), overrides.href);
            }

            return resolved;
        });
    }

    // Add the appropriate documentation links for a fully-resolved link;
    // this should only be called when the link contains a defined rel
    private static docs(response: hal.Response, resolved: hal.Overrides) {
        const docs = Server.linker.getDocs(resolved.server || {}, resolved.rel!);
        if (docs.name) {
            response.docs(docs.name, docs.href);
        }
    }

    // Add a link to the HAL response for the given rel, with any provided overrides
    link(rel: Rel, overrides: hal.Overrides = {}) {
         for (const resolved of Response.resolve(_private(this).server, rel, _private(this).params, overrides)) {
            if (resolved.rel && resolved.href) {
                const str = Rel.stringify(resolved.rel);
                Response.docs(this, resolved);
                _private(this).hal.addLink(str, Template.link(resolved));
                ensureArray(_private(this).hal._links, str, resolved.array);
            } else {
                unresolvableRel(this, rel);
            }
        }
    }

    // Add an embedded value to the HAL response for the given rel, with any provided overrides;
    // returns a HAL response object representing the embedded object, for further linking/embedding
    embed(rel: Rel, value: Object, overrides: hal.Overrides = {}): hal.Response {
        const resolved = Response.resolve(_private(this).server, rel, _private(this).params, overrides)[0];
        if (resolved.rel) {
            const str = Rel.stringify(resolved.rel);
            let resource = Response.resource(resolved, _private(this).root, value);
            Response.docs(this, resolved);
            _private(this).hal.addEmbed(str, _private(resource).hal);
            ensureArray(_private(this).hal._embedded, str, resolved.array);
            return resource;
        } else {
            // If we failed to resolve the rel, return a dummy HAL resource object, but do not embed it
            unresolvableRel(this, rel);
            return Response.resource(
                Object.assign({ server: _private(this).server, params: _private(this).params }, overrides),
                _private(this).root, value);
        }
    }

    // Add a documentation link to the HAL response
    docs(name: string, href: Href) {
        // Add the curie shorthand to the root object if it's not already present
        if (!_private(_private(this).root).hal.getLink(Rel.Curies, (link: Hal.Link) => link.name === name)) {
            // Remove the well-known rel parameter, so that it remains templated
            let params = Object.assign({}, _private(this).params);
            delete params[Rel.Param];

            // Add the documentation link (with fallthrough params from this response)
            _private(_private(this).root).hal.addLink(Rel.Curies, Template.link({ href, id: name, params }));
        }
    }

    // Perform a filter on the link or embed objects
    static filter(response: hal.Response, filter: Response.Filter) {
        if (filter.links) {
            for (const rel of _private(response).hal.listLinkRels().filter(rel => rel !== Rel.Curies)) {
                _private(response).hal.removeLinks(rel, link => !filter.links!(link));
            }
        }
        if (filter.embeds) {
            for (const rel of _private(response).hal.listEmbedRels()) {
                _private(response).hal.removeEmbeds(rel, embed => !filter.embeds!(embed));
            }
        }
    }
}

export namespace Response {
    export interface Private {
        server: Object;
        params: any;
        hal: halson.HALSONResource & Hal.Resource;
        root: hal.Response;
        resolve(rel: Rel, overrides: hal.Overrides): hal.Overrides[];
        docs(resolved: hal.Overrides): void;
    }
    export const Private = Symbol();

    export interface Filter {
        links?: (link: Hal.Link) => boolean;
        embeds?: (embed: Hal.Resource) => boolean;
    }
}

function _private(response: hal.Response): Response.Private {
    return response[Response.Private];
}