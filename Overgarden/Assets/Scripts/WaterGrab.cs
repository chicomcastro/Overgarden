using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class WaterGrab : MonoBehaviour
{
    private bool Proximity = false;
    public Text pressGrab;
    public GameObject Player;
    public GameObject waterBucket;
    public GameObject spawnedWater;
    public GameObject SpawnLocal;
    
    void Start()
    {
        Debug.Log(spawnedWater);
    }

    // Update is called once per frame
    void Update()
    {
        if (Proximity == true)
        {
            pressGrab.enabled = true;
            if (Input.GetKeyDown(KeyCode.E) && spawnedWater == null)
            {
                
                GameObject spawnedWater = Instantiate(waterBucket, SpawnLocal.transform.position, Quaternion.identity) as GameObject;
                spawnedWater.transform.SetParent(Player.gameObject.transform);

                Player.gameObject.GetComponent<EventsManager>().holdingItem = HoldingItem.WATER;

                Debug.Log(spawnedWater);
            }
            
            
        }
        else if (spawnedWater != null && Input.GetKeyDown(KeyCode.E))
        {
            spawnedWater.transform.SetParent(null);
            Destroy(spawnedWater);
        }
        else
        {
            pressGrab.enabled = false;
        }


        

        
        
    }

    private void OnTriggerEnter2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
            Proximity = true;
       }
        
    }
    private void OnTriggerExit2D(Collider2D other)
    {
       if (other.tag == "Player")
       {
           Proximity = false;
           
           
       }  
    }

    

}
